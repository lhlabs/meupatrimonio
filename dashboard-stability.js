import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthNames=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
let currentUser=null, timer=null, observer=null, db=null;

function selectedMonth(){
  const text=norm(document.querySelector('#monthLabel')?.textContent||'');
  const mi=monthNames.findIndex(m=>text.includes(m));
  const year=(text.match(/(20\d{2})/)||[])[1];
  return new Date(year?Number(year):new Date().getFullYear(),mi>=0?mi:new Date().getMonth(),1);
}
async function getCol(uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function isContribution(x){const c=norm(x?.category);return x?.type==='expense'&&(c.includes('aporte')||c.includes('investimento'))}
function isDebt(p){const t=norm(p?.type);return ['debt','divida','dívida','liability'].includes(t)}
function isReserve(p){const t=norm(p?.type);return ['reserve','reserva','reserva de emergencia','reserva de emergência'].includes(t)}
function activeRecurringExpense(r,today){
  if(!r||r.active!==true||r.type!=='expense'||isContribution(r)||Number(r.amount||0)<=0)return false;
  if(r.endDate&&r.endDate<today)return false;
  return true;
}
function setText(sel,value){const el=document.querySelector(sel);if(el&&el.textContent!==value)el.textContent=value}

async function calculate(){
  if(!currentUser)return;
  const target=selectedMonth(),key=monthKey(target),today=new Date().toISOString().slice(0,10);
  const [tx,pos,recurring,goalSnap]=await Promise.all([
    getCol(currentUser.uid,'transactions'),getCol(currentUser.uid,'positions'),getCol(currentUser.uid,'recurring'),getDoc(doc(db,'users',currentUser.uid,'monthlyGoals',key))
  ]);
  const rows=tx.filter(t=>String(t.date||'').startsWith(key));
  const contributions=rows.filter(isContribution).reduce((s,t)=>s+Number(t.amount||0),0);
  const consumption=rows.filter(t=>t.type==='expense'&&!isContribution(t)).reduce((s,t)=>s+Number(t.amount||0),0);
  const goal=goalSnap.exists()?goalSnap.data():null;
  const contributionGoal=Number(goal?.monthlySurplusGoal||0),spendGoal=Number(goal?.dailySpendGoal||0);

  const reserve=pos.filter(isReserve).reduce((s,p)=>s+Number(p.value||0),0);
  const debts=pos.filter(isDebt).reduce((s,p)=>s+Number(p.value||0),0);
  const debtCount=pos.filter(isDebt).length;
  const recurringMonthly=recurring.filter(r=>activeRecurringExpense(r,today)).reduce((s,r)=>s+Number(r.amount||0),0);
  const reserveTarget=recurringMonthly*6;
  const reserveProgress=reserveTarget>0?clamp(reserve/reserveTarget,0,1):null;
  const reserveMonths=recurringMonthly>0?reserve/recurringMonthly:null;

  observer?.disconnect();
  try{
    // Dívidas: saldo devedor cadastrado em Patrimônio, nunca soma parcelas mensais.
    if(debtCount>0){setText('#debtValue',currency.format(debts));setText('#debtRatio',debts>0?'Saldo devedor cadastrado':'Dívida cadastrada com saldo R$ 0,00');}
    else{setText('#debtValue','—');setText('#debtRatio','Cadastre o saldo devedor em Patrimônio → Dívida');}

    // Reserva estrutural = 6 x despesas recorrentes mensais ativas.
    if(reserveProgress!==null){
      setText('#reserveMonths',`${reserveMonths.toFixed(1)} / 6 meses`);
      setText('#reserveValue',`${currency.format(reserve)} de ${currency.format(reserveTarget)}`);
      setText('#freedomPercent',`${Math.round(reserveProgress*100)}%`);
      document.querySelector('#freedomRing')?.style.setProperty('--p',`${reserveProgress*100}%`);
      setText('#freedomTarget',currency.format(reserveTarget));
      setText('#freedomGap',currency.format(Math.max(0,reserveTarget-reserve)));
      setText('#freedomBadge',`Reserva ${reserveMonths.toFixed(1)}/6 meses`);
    }

    // Cofrinho: apenas aportes, gastos mensais e reserva.
    const measures=[],vitals=[];
    if(contributionGoal>0){const s=clamp(contributions/contributionGoal,0,1);measures.push({s,w:40});vitals.push(['Aportes',`${Math.round(s*100)}%`]);}else vitals.push(['Aportes','—']);
    if(spendGoal>0){const s=consumption<=spendGoal?1:clamp(spendGoal/Math.max(consumption,.01),0,1);measures.push({s,w:35});vitals.push(['Gastos',consumption<=spendGoal?'Dentro':'Acima']);}else vitals.push(['Gastos','—']);
    if(reserveProgress!==null){measures.push({s:reserveProgress,w:25});vitals.push(['Reserva',`${reserveMonths.toFixed(1)}/6`]);}else vitals.push(['Reserva','—']);
    const totalWeight=measures.reduce((s,x)=>s+x.w,0);
    const health=totalWeight?Math.round(measures.reduce((s,x)=>s+x.s*x.w,0)/totalWeight):null;

    const petVitals=document.querySelector('#petVitals');if(petVitals)petVitals.innerHTML=vitals.map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
    setText('#financeScore',health===null?'—':String(health));
    document.querySelector('#scoreRing')?.style.setProperty('--p',`${health??0}%`);
    setText('#scoreLabel',health===null?'Aguardando metas':health>=85?'Excelente':health>=70?'Forte':health>=50?'Em evolução':'Atenção');
    setText('#scoreHint',health===null?'Defina meta de aporte e limite mensal de gastos.':'Score = aportes 40% + gastos 35% + reserva 25%.');
    const hb=document.querySelector('#petHealthBadge');if(hb){hb.textContent=health===null?'Saúde —':`Saúde ${health}%`;hb.className=`health-badge ${health===null?'warn':health>=70?'good':health>=45?'warn':'bad'}`;}
    const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health??0}%`;
    let avatar='🐷',state='Aguardando metas',msg='Defina meta de aporte, limite mensal de gastos e mantenha a reserva adequada.';
    if(health!==null){if(health>=85){avatar='🐷✨';state='Radiante';msg='Aportes, gastos e reserva estão muito bem alinhados.';}else if(health>=70){state='Saudável';msg='Boa disciplina financeira neste mês.';}else if(health>=50){avatar='🐽';state='Em atenção';msg='Uma das metas financeiras precisa de atenção.';}else{avatar='😵‍💫';state='Crítico';msg='Aportes, gastos ou reserva exigem correção.';}}
    setText('#petAvatar',avatar);setText('#petName',`Cofrinho · ${state}`);setText('#petMessage',msg);

    // Garante que o conceito antigo de gasto diário não reapareça.
    const goalCard=document.querySelector('.goal-card');if(goalCard){const h=goalCard.querySelector('h2');if(h)h.textContent='Metas financeiras do mês';const spans=goalCard.querySelectorAll('.goal-grid > div > span');if(spans[0])spans[0].textContent='Meta de aporte';if(spans[1])spans[1].textContent='Limite de gastos';}
  } finally {
    observeTargets();
  }
}

function schedule(delay=80){clearTimeout(timer);timer=setTimeout(()=>calculate().catch(console.warn),delay)}
function observeTargets(){
  if(!observer)observer=new MutationObserver(()=>schedule(60));
  observer.disconnect();
  ['#financeScore','#petVitals','#debtValue','#reserveMonths','#monthLabel'].forEach(sel=>{const el=document.querySelector(sel);if(el)observer.observe(el,{childList:true,subtree:true,characterData:true});});
}

window.addEventListener('load',()=>{
  db=getFirestore(getApp());const auth=getAuth(getApp());
  onAuthStateChanged(auth,u=>{currentUser=u;if(u){observeTargets();schedule(900);setTimeout(()=>schedule(0),2200);}});
  document.addEventListener('submit',()=>{schedule(700);setTimeout(()=>schedule(0),1500);});
  document.addEventListener('click',e=>{if(e.target.closest('#prevMonth,#nextMonth,.nav-item,[data-go],[data-delete-position],[data-delete-tx],[data-del-rec],[data-edit-rec]')){schedule(180);setTimeout(()=>schedule(0),700);}});
});
