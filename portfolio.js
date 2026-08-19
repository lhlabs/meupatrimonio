import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { contributionBalance, isWithdrawal, monthMetrics, projectFutureValue, safeNumber, WITHDRAWAL_CATEGORY, ymd } from "./finance-logic.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthNames=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
let currentUser=null, db=null, timer=null, latestTx=[], withdrawalBusy=false;

function norm(value=''){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function selectedMonth(){
  const text=norm(document.querySelector('#monthLabel')?.textContent||'');
  const month=monthNames.findIndex(name=>text.includes(name));
  const year=Number((text.match(/20\d{2}/)||[])[0])||new Date().getFullYear();
  return new Date(year,month>=0?month:new Date().getMonth(),1);
}
function setText(selector,value){const el=document.querySelector(selector);if(el)el.textContent=value;}
function toast(message){const el=document.querySelector('#toast');if(!el)return;el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800);}
async function getCollection(uid,name){const snap=await getDocs(collection(db,'users',uid,name));return snap.docs.map(item=>({id:item.id,...item.data()}));}
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
  const available=contributionBalance(latestTx,ymd(new Date()));
  if(!(available>0))return toast('Não há patrimônio de aportes disponível para resgate.');
  document.querySelector('#withdrawalAmount').value='';
  document.querySelector('#withdrawalAmount').max=String(available);
  document.querySelector('#withdrawalDate').value=ymd(new Date());
  document.querySelector('#withdrawalAvailable').textContent=`Disponível para movimentação: ${currency.format(available)}`;
  document.querySelector('#withdrawalDialog').showModal();
}
async function submitWithdrawal(event){
  event.preventDefault();
  if(withdrawalBusy||!currentUser)return;
  const button=event.submitter, amount=safeNumber(document.querySelector('#withdrawalAmount').value), date=document.querySelector('#withdrawalDate').value, description=document.querySelector('#withdrawalDescription').value.trim()||'Resgate para saldo em conta';
  const available=contributionBalance(latestTx,date);
  if(!(amount>0))return toast('Informe um valor válido.');
  if(amount>available)return toast(`O máximo disponível nessa data é ${currency.format(available)}.`);
  withdrawalBusy=true;if(button)button.disabled=true;
  try{
    await addDoc(collection(db,'users',currentUser.uid,'transactions'),{type:'income',amount,category:WITHDRAWAL_CATEGORY,description,date,recurring:false,createdAt:serverTimestamp()});
    document.querySelector('#withdrawalDialog').close();
    toast('Valor movimentado para o saldo do mês.');
    setTimeout(()=>window.location.reload(),350);
  }catch(error){console.error(error);toast('Não foi possível realizar o resgate.');}
  finally{withdrawalBusy=false;if(button)button.disabled=false;}
}
function renderAutomaticPosition(autoBalance,manual,planning){
  const totalAssets=manual.assets+autoBalance, netWorth=totalAssets-manual.debts;
  setText('#assetsTotal',currency.format(totalAssets));
  setText('#patrimonyNetWorth',currency.format(netWorth));
  setText('#netWorth',currency.format(netWorth));
  setText('#netWorthContext',`${currency.format(totalAssets)} em ativos − ${currency.format(manual.debts)} em dívidas`);
  const debtText=document.querySelector('#debtRatio');if(debtText&&manual.debts>0)debtText.textContent=`${(totalAssets?manual.debts/totalAssets*100:0).toFixed(1)}% dos ativos`;

  const list=document.querySelector('#positionsList');
  if(list){
    list.querySelector('[data-auto-contribution-position]')?.remove();
    const row=document.createElement('div');row.className='list-row';row.dataset.autoContributionPosition='true';
    row.innerHTML=`<div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · aportes menos resgates</small></div><div><div class="money income">${currency.format(autoBalance)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution ${autoBalance>0?'':'disabled'}>Mover para saldo</button></div></div>`;
    list.prepend(row);
  }

  const projection=document.querySelector('#projectionGrid');
  if(projection&&planning){
    const monthly=safeNumber(planning.monthlyContributionGoal), rate=safeNumber(planning.realReturn??5);
    projection.innerHTML=[5,10,20,30].map(years=>`<div class="projection-item"><span>${years} anos</span><strong>${currency.format(projectFutureValue({annualRealRate:rate,years,startingValue:netWorth,monthlyContribution:monthly}))}</strong></div>`).join('');
  }
}
function renderTransferLabels(){
  const savingLabel=document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');if(savingLabel)savingLabel.textContent='Taxa de aporte líquido';
  const firstGoal=document.querySelector('.goal-card .goal-grid > div > span');if(firstGoal)firstGoal.textContent='Aporte líquido';
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
async function refresh(){
  if(!currentUser||!db)return;
  try{
    const [tx,positions,planningSnap]=await Promise.all([getCollection(currentUser.uid,'transactions'),getCollection(currentUser.uid,'positions'),getDoc(doc(db,'users',currentUser.uid,'config','planning'))]);
    latestTx=tx;
    const autoBalance=contributionBalance(tx,ymd(new Date())), manual=manualPositionMetrics(positions), planning=planningSnap.exists()?planningSnap.data():null;
    renderAutomaticPosition(autoBalance,manual,planning);renderTransferLabels();protectWithdrawalEdits();
  }catch(error){console.warn('Patrimônio automático:',error);}
}
function schedule(delay=500){clearTimeout(timer);timer=setTimeout(refresh,delay);}

window.addEventListener('load',()=>{
  db=getFirestore(getApp());const auth=getAuth(getApp());ensureWithdrawalDialog();
  onAuthStateChanged(auth,user=>{currentUser=user;if(user){schedule(900);setTimeout(()=>schedule(0),1800);}});
  document.addEventListener('click',event=>{
    const withdraw=event.target.closest('[data-withdraw-contribution]');if(withdraw){event.preventDefault();openWithdrawal();return;}
    const edit=event.target.closest('[data-edit-tx]');if(edit&&latestTx.some(tx=>tx.id===edit.dataset.editTx&&isWithdrawal(tx))){event.preventDefault();event.stopImmediatePropagation();toast('Para alterar um resgate, exclua-o e faça uma nova movimentação.');return;}
    if(event.target.closest('[data-delete-tx],[data-edit-position],[data-delete-position],.nav-item,[data-go],#prevMonth,#nextMonth')){schedule(800);setTimeout(()=>schedule(0),1500);}
  },true);
  document.addEventListener('submit',()=>{schedule(900);setTimeout(()=>schedule(0),1700);},true);
});
