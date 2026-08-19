import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const contributionCategory='Investimentos/Aportes';

async function col(db,uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function isContribution(t){const c=norm(t.category);return t.type==='expense'&&(c.includes('aporte')||c.includes('investimento'))}
function monthRows(tx,d=new Date()){const k=monthKey(d);return tx.filter(t=>String(t.date||'').startsWith(k))}
function setText(sel,val){const e=document.querySelector(sel);if(e)e.textContent=val}

function activeRecurringExpense(r,today){
  if(!r||r.active!==true||r.type!=='expense')return false;
  if(r.endDate&&r.endDate<today)return false;
  return Number(r.amount||0)>0;
}

function injectContributionCategory(){
  const type=document.querySelector('#transactionType')?.value||'expense';
  const tx=document.querySelector('#transactionCategory');
  if(tx&&type==='expense'&&![...tx.options].some(o=>o.value===contributionCategory))tx.add(new Option(contributionCategory,contributionCategory));
  for(const [typeSel,catSel] of [['#recurringType','#recurringCategory'],['#scheduledType','#scheduledCategory']]){
    const ts=document.querySelector(typeSel),cs=document.querySelector(catSel);
    if(ts&&cs&&ts.value==='expense'&&![...cs.options].some(o=>o.value===contributionCategory))cs.add(new Option(contributionCategory,contributionCategory));
  }
}

function relabelGoalUI(){
  const form=document.querySelector('#monthlyGoalForm');
  if(form){
    const labels=[...form.querySelectorAll('label')];
    labels.forEach(l=>{
      const inp=l.querySelector('input');
      if(inp?.id==='monthlyGoalSurplus')l.childNodes[0].textContent='Meta de aporte do mês';
      if(inp?.id==='monthlyGoalDaily')l.childNodes[0].textContent='Limite de gastos do mês';
    });
    const p=form.querySelector('p');if(p)p.textContent='Defina quanto pretende aportar e o limite total de gastos de consumo em cada mês.';
  }
  const goalCard=document.querySelector('.goal-card');if(goalCard){
    const title=goalCard.querySelector('h2');if(title)title.textContent='Metas financeiras do mês';
    const spans=goalCard.querySelectorAll('.goal-grid > div > span');if(spans[0])spans[0].textContent='Meta de aporte';if(spans[1])spans[1].textContent='Limite de gastos';
  }
  const saving=document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');if(saving)saving.textContent='Taxa de aporte';
  const debt=document.querySelector('#debtValue')?.closest('.mini-metric')?.querySelector('span');if(debt)debt.textContent='Dívidas cadastradas';
}

async function refresh(db,user){
  const now=new Date(),key=monthKey(now),today=`${key}-${String(now.getDate()).padStart(2,'0')}`;
  const [tx,pos,recurring,goalSnap]=await Promise.all([
    col(db,user.uid,'transactions'),
    col(db,user.uid,'positions'),
    col(db,user.uid,'recurring'),
    getDoc(doc(db,'users',user.uid,'monthlyGoals',key))
  ]);
  const rows=monthRows(tx,now),income=rows.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
  const contributions=rows.filter(isContribution).reduce((s,t)=>s+Number(t.amount||0),0);
  const consumption=rows.filter(t=>t.type==='expense'&&!isContribution(t)).reduce((s,t)=>s+Number(t.amount||0),0);
  const goal=goalSnap.exists()?goalSnap.data():null;
  // Compatibilidade: monthlySurplusGoal armazena meta de aporte; dailySpendGoal armazena limite mensal de gastos.
  const contributionGoal=Number(goal?.monthlySurplusGoal||0),spendGoal=Number(goal?.dailySpendGoal||0);

  const recurringMonthly=recurring.filter(r=>activeRecurringExpense(r,today)&&!isContribution(r)).reduce((s,r)=>s+Number(r.amount||0),0);
  const reserve=pos.filter(p=>p.type==='reserve').reduce((s,p)=>s+Number(p.value||0),0);
  const reserveTarget=recurringMonthly*6;
  const reserveProgress=reserveTarget>0?clamp(reserve/reserveTarget,0,1):null;
  const reserveMonths=recurringMonthly>0?reserve/recurringMonthly:null;

  // Taxa de aporte: clara e mensurável. Sem renda, não inventa percentual.
  if(income>0){setText('#savingRate',`${(contributions/income*100).toFixed(1)}%`);setText('#savingStatus',`${currency.format(contributions)} aportados de ${currency.format(income)} recebidos`);}else{setText('#savingRate','—');setText('#savingStatus','Sem receita lançada no mês');}

  // Reserva = 6x despesas recorrentes mensais ativas.
  if(recurringMonthly>0){
    setText('#reserveMonths',`${(reserveMonths||0).toFixed(1)} / 6 meses`);
    setText('#reserveValue',`${currency.format(reserve)} de ${currency.format(reserveTarget)}`);
    setText('#freedomPercent',`${Math.round((reserveProgress||0)*100)}%`);
    document.querySelector('#freedomRing')?.style.setProperty('--p',`${(reserveProgress||0)*100}%`);
    setText('#freedomTarget',currency.format(reserveTarget));
    setText('#freedomGap',currency.format(Math.max(0,reserveTarget-reserve)));
    setText('#freedomBadge',`Reserva ${(reserveMonths||0).toFixed(1)}/6 meses`);
  }else{
    setText('#reserveMonths','—');setText('#reserveValue','Nenhuma despesa recorrente ativa identificada');setText('#freedomPercent','—');document.querySelector('#freedomRing')?.style.setProperty('--p','0%');setText('#freedomTarget','—');setText('#freedomGap','—');setText('#freedomBadge','Cadastre contas recorrentes');
  }

  // Dívidas são informativas; não entram no score sem cadastro real.
  const debts=pos.filter(p=>p.type==='debt').reduce((s,p)=>s+Number(p.value||0),0);
  if(pos.length===0){setText('#debtValue','—');setText('#debtRatio','Nenhuma posição patrimonial cadastrada');}
  else if(debts===0){setText('#debtValue',currency.format(0));setText('#debtRatio','Nenhuma dívida cadastrada');}
  else{setText('#debtValue',currency.format(debts));setText('#debtRatio','Saldo devedor cadastrado');}

  // Metas mensais: aporte e gasto total de consumo do mês.
  setText('#surplusGoalStatus',currency.format(contributions));
  setText('#surplusGoalDetail',contributionGoal>0?`Meta ${currency.format(contributionGoal)} · ${contributions>=contributionGoal?'atingida':'faltam '+currency.format(contributionGoal-contributions)}`:'Defina a meta de aporte em Metas');
  setText('#dailyGoalStatus',currency.format(consumption));
  setText('#dailyGoalDetail',spendGoal>0?`Limite ${currency.format(spendGoal)} · ${consumption<=spendGoal?'dentro do limite':'excesso de '+currency.format(consumption-spendGoal)}`:'Defina o limite mensal em Metas');

  const measures=[],vitals=[];
  if(contributionGoal>0){const score=clamp(contributions/contributionGoal,0,1);measures.push({score,weight:40});vitals.push(['Aportes',`${Math.round(score*100)}%`]);}else vitals.push(['Aportes','—']);
  if(spendGoal>0){const score=consumption<=spendGoal?1:clamp(spendGoal/Math.max(consumption,.01),0,1);measures.push({score,weight:35});vitals.push(['Gastos',consumption<=spendGoal?'Dentro':'Acima']);}else vitals.push(['Gastos','—']);
  if(reserveProgress!==null){measures.push({score:reserveProgress,weight:25});vitals.push(['Reserva',`${(reserveMonths||0).toFixed(1)}/6`]);}else vitals.push(['Reserva','—']);

  const weight=measures.reduce((s,x)=>s+x.weight,0),health=weight?Math.round(measures.reduce((s,x)=>s+x.score*x.weight,0)/weight):null;
  const vit=document.querySelector('#petVitals');if(vit)vit.innerHTML=vitals.map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  const hb=document.querySelector('#petHealthBadge');if(hb){hb.textContent=health===null?'Saúde —':`Saúde ${health}%`;hb.className=`health-badge ${health===null?'warn':health>=70?'good':health>=45?'warn':'bad'}`;}
  const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health??0}%`;
  let avatar='🐷',state='Aguardando metas',msg='Defina meta de aporte, limite de gastos e mantenha a reserva adequada.';
  if(health!==null){if(health>=85){avatar='🐷✨';state='Radiante';msg='Aportes, gastos e reserva estão muito bem alinhados.';}else if(health>=70){state='Saudável';msg='Boa disciplina financeira neste mês.';}else if(health>=50){avatar='🐽';state='Em atenção';msg='Uma das metas do mês está pressionando sua saúde financeira.';}else{avatar='😵‍💫';state='Crítico';msg='Aportes, gastos ou reserva exigem correção.';}}
  setText('#petAvatar',avatar);setText('#petName',`Cofrinho · ${state}`);setText('#petMessage',msg);
  setText('#financeScore',health===null?'—':String(health));document.querySelector('#scoreRing')?.style.setProperty('--p',`${health??0}%`);setText('#scoreLabel',health===null?'Aguardando metas':health>=85?'Excelente':health>=70?'Forte':health>=50?'Em evolução':'Atenção');setText('#scoreHint',health===null?'Sem nota até existirem indicadores calculáveis.':'Score = aportes 40% + gastos 35% + reserva 25%, usando apenas metas disponíveis.');

  const missions=document.querySelector('#missionsList');if(missions){const items=[];
    items.push(['📈','Meta de aportes',contributionGoal>0?`${currency.format(contributions)} / ${currency.format(contributionGoal)}`:'Defina uma meta mensal',contributionGoal>0?clamp(contributions/contributionGoal,0,1):0]);
    items.push(['🎯','Limite de gastos',spendGoal>0?`${currency.format(consumption)} / ${currency.format(spendGoal)}`:'Defina um limite mensal',spendGoal>0?(consumption<=spendGoal?1:clamp(spendGoal/Math.max(consumption,.01),0,1)):0]);
    items.push(['🛟','Reserva de emergência',recurringMonthly>0?`${currency.format(reserve)} / ${currency.format(reserveTarget)}`:'Cadastre despesas recorrentes ativas',reserveProgress??0]);
    missions.innerHTML=items.map(([i,n,d,p])=>`<div class="mission ${p>=1?'done':''}"><div class="mission-icon">${i}</div><div><strong>${n}</strong><p>${d}</p><div class="mission-progress"><i style="width:${p*100}%"></i></div></div></div>`).join('');
  }
  relabelGoalUI();injectContributionCategory();
}

window.addEventListener('load',()=>{
  const app=getApp(),auth=getAuth(app),db=getFirestore(app);let user=null;
  const run=()=>user&&refresh(db,user).catch(console.warn);
  relabelGoalUI();injectContributionCategory();
  new MutationObserver(()=>{relabelGoalUI();injectContributionCategory()}).observe(document.body,{childList:true,subtree:true});
  onAuthStateChanged(auth,u=>{user=u;if(u){setTimeout(run,1800);setTimeout(run,3200)}});
  document.addEventListener('submit',()=>setTimeout(run,1500));
  document.addEventListener('click',e=>{if(e.target.closest('#quickAddBtn,#openTransactionBtn,#openRecurringBtn,#openScheduledBtn,[data-delete-tx],[data-delete-position],[data-del-rec],[data-edit-rec],#prevMonth,#nextMonth,[data-go]'))setTimeout(()=>{injectContributionCategory();run()},1500)});
  document.querySelector('#transactionType')?.addEventListener('change',injectContributionCategory);
  document.querySelector('#recurringType')?.addEventListener('change',()=>setTimeout(injectContributionCategory,0));
  document.querySelector('#scheduledType')?.addEventListener('change',()=>setTimeout(injectContributionCategory,0));
});
