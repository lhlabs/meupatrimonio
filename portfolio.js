import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { contributionBalance, isWithdrawal, monthMetrics, projectFutureValue, safeNumber, WITHDRAWAL_CATEGORY, ymd } from "./finance-logic.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthNames=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
let currentUser=null, db=null, latestTx=[], latestPositions=[], latestPlanning=null, withdrawalBusy=false;
let unsubs=[];

function norm(value=''){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function selectedMonth(){
  const text=norm(document.querySelector('#monthLabel')?.textContent||'');
  const month=monthNames.findIndex(name=>text.includes(name));
  const year=Number((text.match(/20\d{2}/)||[])[0])||new Date().getFullYear();
  return new Date(year,month>=0?month:new Date().getMonth(),1);
}
function setText(selector,value){const el=document.querySelector(selector);if(el)el.textContent=value;}
function toast(message){const el=document.querySelector('#toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2800);}
function manualPositionMetrics(positions){
  const assets=positions.filter(item=>['asset','reserve'].includes(item.type)).reduce((sum,item)=>sum+safeNumber(item.value),0);
  const debts=positions.filter(item=>item.type==='debt').reduce((sum,item)=>sum+safeNumber(item.value),0);
  return {assets,debts};
}
function ensureWithdrawalDialog(){
  if(document.querySelector('#withdrawalDialog'))return;
  const dialog=document.createElement('dialog');
  dialog.id='withdrawalDialog';
  dialog.innerHTML=`<form id="withdrawalForm" method="dialog" class="sheet-form"><div class="dialog-head"><div><span class="card-kicker">MOVIMENTAÇÃO PATRIMONIAL</span><h2>Resgatar para o saldo do mês</h2></div><button type="button" class="icon-btn" id="closeWithdrawalDialog">×</button></div><p class="muted" style="margin-top:0">O valor sai do patrimônio acumulado por aportes e entra no saldo em conta do mês. Não será contado como renda.</p><label>Valor<input id="withdrawalAmount" type="number" min="0.01" step="0.01" required></label><label>Data<input id="withdrawalDate" type="date" required></label><label>Descrição<input id="withdrawalDescription" maxlength="80" value="Resgate para saldo em conta"></label><div id="withdrawalAvailable" class="muted"></div><button class="primary" type="submit">Confirmar resgate</button></form>`;
  document.body.appendChild(dialog);
  document.querySelector('#closeWithdrawalDialog').addEventListener('click',()=>dialog.close());
  document.querySelector('#withdrawalForm').addEventListener('submit',submitWithdrawal);
}
function openWithdrawal(){
  ensureWithdrawalDialog();
  const today=ymd(new Date());
  const available=contributionBalance(latestTx,today);
  if(!(available>0))return toast('Não há patrimônio de aportes disponível para resgate.');
  document.querySelector('#withdrawalAmount').value='';
  document.querySelector('#withdrawalAmount').max=String(available);
  document.querySelector('#withdrawalDate').value=today;
  document.querySelector('#withdrawalAvailable').textContent=`Disponível até hoje: ${currency.format(available)}`;
  document.querySelector('#withdrawalDialog').showModal();
}
async function submitWithdrawal(event){
  event.preventDefault();
  if(withdrawalBusy||!currentUser)return;
  const button=event.submitter;
  const amount=safeNumber(document.querySelector('#withdrawalAmount').value);
  const date=document.querySelector('#withdrawalDate').value;
  const description=document.querySelector('#withdrawalDescription').value.trim()||'Resgate para saldo em conta';
  const available=contributionBalance(latestTx,date);
  if(!(amount>0))return toast('Informe um valor válido.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return toast('Informe uma data válida.');
  if(amount>available)return toast(`O máximo disponível nessa data é ${currency.format(available)}.`);
  withdrawalBusy=true;if(button)button.disabled=true;
  try{
    await addDoc(collection(db,'users',currentUser.uid,'transactions'),{type:'income',amount,category:WITHDRAWAL_CATEGORY,description,date,recurring:false,createdAt:serverTimestamp()});
    document.querySelector('#withdrawalDialog').close();
    toast('Valor movimentado para o saldo do mês.');
  }catch(error){console.error(error);toast('Não foi possível realizar o resgate.');}
  finally{withdrawalBusy=false;if(button)button.disabled=false;}
}
function ensureAutomaticPosition(autoBalance){
  const list=document.querySelector('#positionsList');
  if(!list)return;
  let row=list.querySelector('[data-auto-contribution-position]');
  if(!row){
    row=document.createElement('div');
    row.className='list-row';
    row.dataset.autoContributionPosition='true';
    list.prepend(row);
  }
  row.innerHTML=`<div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · aportes menos resgates</small></div><div><div class="money income">${currency.format(autoBalance)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution ${autoBalance>0?'':'disabled'}>Mover para saldo</button></div></div>`;
  list.classList.remove('empty-state');
}
function renderAutomaticPosition(){
  if(!currentUser)return;
  // Todo lançamento salvo como aporte é uma movimentação patrimonial efetiva. Não dependemos do mês exibido no dashboard.
  const autoBalance=contributionBalance(latestTx);
  const manual=manualPositionMetrics(latestPositions);
  const totalAssets=manual.assets+autoBalance;
  const netWorth=totalAssets-manual.debts;
  setText('#assetsTotal',currency.format(totalAssets));
  setText('#debtsTotal',currency.format(manual.debts));
  setText('#patrimonyNetWorth',currency.format(netWorth));
  setText('#netWorth',currency.format(netWorth));
  setText('#netWorthContext',`${currency.format(totalAssets)} em ativos − ${currency.format(manual.debts)} em dívidas`);
  const debtText=document.querySelector('#debtRatio');
  if(debtText&&manual.debts>0)debtText.textContent=`${(totalAssets?manual.debts/totalAssets*100:0).toFixed(1)}% dos ativos`;
  ensureAutomaticPosition(autoBalance);

  const projection=document.querySelector('#projectionGrid');
  if(projection&&latestPlanning){
    const monthly=safeNumber(latestPlanning.monthlyContributionGoal),rate=safeNumber(latestPlanning.realReturn??5);
    projection.innerHTML=[5,10,20,30].map(years=>`<div class="projection-item"><span>${years} anos</span><strong>${currency.format(projectFutureValue({annualRealRate:rate,years,startingValue:netWorth,monthlyContribution:monthly}))}</strong></div>`).join('');
  }
}
function renderTransferLabels(){
  const savingLabel=document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');
  if(savingLabel)savingLabel.textContent='Taxa de aporte líquido';
  const firstGoal=document.querySelector('.goal-card .goal-grid > div > span');
  if(firstGoal)firstGoal.textContent='Aporte líquido';
  const metrics=monthMetrics(latestTx,selectedMonth());
  if(metrics.withdrawal>0){
    setText('#savingStatus',`Aporte líquido ${currency.format(metrics.contribution)} · aportes ${currency.format(metrics.grossContribution)} · resgates ${currency.format(metrics.withdrawal)}`);
  }
}
function protectWithdrawalEdits(){
  latestTx.filter(isWithdrawal).forEach(tx=>{
    document.querySelectorAll(`[data-edit-tx="${CSS.escape(tx.id)}"]`).forEach(button=>button.remove());
  });
}
function render(){
  renderAutomaticPosition();
  renderTransferLabels();
  protectWithdrawalEdits();
}
function reapplySoon(){
  requestAnimationFrame(()=>requestAnimationFrame(render));
  setTimeout(render,180);
}
function stopSubscriptions(){unsubs.forEach(unsub=>{try{unsub();}catch{}});unsubs=[];}
function subscribe(uid){
  stopSubscriptions();
  unsubs.push(onSnapshot(collection(db,'users',uid,'transactions'),snap=>{
    latestTx=snap.docs.map(item=>({id:item.id,...item.data()}));
    render();
  },error=>console.warn('Patrimônio/lançamentos:',error)));
  unsubs.push(onSnapshot(collection(db,'users',uid,'positions'),snap=>{
    latestPositions=snap.docs.map(item=>({id:item.id,...item.data()}));
    render();
  },error=>console.warn('Patrimônio/posições:',error)));
  unsubs.push(onSnapshot(doc(db,'users',uid,'config','planning'),snap=>{
    latestPlanning=snap.exists()?snap.data():null;
    render();
  },error=>console.warn('Patrimônio/planejamento:',error)));
}

window.addEventListener('load',()=>{
  db=getFirestore(getApp());
  const auth=getAuth(getApp());
  ensureWithdrawalDialog();
  onAuthStateChanged(auth,user=>{
    currentUser=user;
    latestTx=[];latestPositions=[];latestPlanning=null;
    if(user)subscribe(user.uid);else stopSubscriptions();
  });

  const positionsList=document.querySelector('#positionsList');
  if(positionsList){
    new MutationObserver(()=>{
      if(currentUser&&!positionsList.querySelector('[data-auto-contribution-position]'))reapplySoon();
    }).observe(positionsList,{childList:true});
  }
  const monthLabel=document.querySelector('#monthLabel');
  if(monthLabel)new MutationObserver(reapplySoon).observe(monthLabel,{childList:true,characterData:true,subtree:true});

  document.addEventListener('click',event=>{
    const withdraw=event.target.closest('[data-withdraw-contribution]');
    if(withdraw){event.preventDefault();openWithdrawal();return;}
    const edit=event.target.closest('[data-edit-tx]');
    if(edit&&latestTx.some(tx=>tx.id===edit.dataset.editTx&&isWithdrawal(tx))){
      event.preventDefault();event.stopImmediatePropagation();toast('Para alterar um resgate, exclua-o e faça uma nova movimentação.');return;
    }
    if(event.target.closest('[data-delete-tx],[data-edit-position],[data-delete-position],.nav-item,[data-go],#prevMonth,#nextMonth'))reapplySoon();
  },true);
  document.addEventListener('submit',reapplySoon,true);
});
