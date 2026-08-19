import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const monthNames=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const dueDateFor=(y,m,day)=>`${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(Number(day),new Date(y,m+1,0).getDate())).padStart(2,'0')}`;

async function col(db,uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function selectedMonth(){const text=norm(document.querySelector('#monthLabel')?.textContent||'');const mi=monthNames.findIndex(m=>text.includes(m));const ym=text.match(/(20\d{2})/);return new Date(ym?Number(ym[1]):new Date().getFullYear(),mi>=0?mi:new Date().getMonth(),1)}
function recurringValidInMonth(r,d){if(!r.active||r.type!=='expense')return false;const due=dueDateFor(d.getFullYear(),d.getMonth(),r.dayOfMonth);if(r.startDate&&due<r.startDate)return false;if(r.endDate&&due>r.endDate)return false;return true}
function monthTotals(tx,d){const k=monthKey(d),rows=tx.filter(t=>String(t.date||'').startsWith(k)),income=rows.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0),expense=rows.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);return{rows,income,expense,balance:income-expense}}
function setText(sel,val){const e=document.querySelector(sel);if(e)e.textContent=val}

function relabelStaticUI(){
  const saving=document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');if(saving)saving.textContent='Taxa de poupança';
  const debt=document.querySelector('#debtValue')?.closest('.mini-metric')?.querySelector('span');if(debt)debt.textContent='Dívidas cadastradas';
  const freedom=document.querySelector('.freedom-card');if(freedom){const kicker=freedom.querySelector('.card-kicker'),title=freedom.querySelector('h2');if(kicker)kicker.textContent='RESERVA DE EMERGÊNCIA';if(title)title.textContent='Cobertura da reserva';}
  const freedomSmall=document.querySelector('#freedomPercent')?.parentElement?.querySelector('small');if(freedomSmall)freedomSmall.textContent='da meta de 6 meses';
  const targetLabel=document.querySelector('#freedomTarget')?.parentElement?.querySelector('span');if(targetLabel)targetLabel.textContent='Meta 6× recorrentes';
  const gapLabel=document.querySelector('#freedomGap')?.parentElement?.querySelector('span');if(gapLabel)gapLabel.textContent='Falta';
  const ff=document.querySelector('#financialFreedomMonthlyCost')?.closest('label');if(ff)ff.style.display='none';
  const rt=document.querySelector('#reserveTargetMonths');if(rt){rt.value='6';rt.disabled=true;const label=rt.closest('label');if(label)label.childNodes[0].textContent='Reserva-alvo — 6 meses';}
}

async function refreshIntegrity(db,user){
  const [tx,pos,recurring,goalSnap]=await Promise.all([
    col(db,user.uid,'transactions'),col(db,user.uid,'positions'),col(db,user.uid,'recurring'),getDoc(doc(db,'users',user.uid,'monthlyGoals',monthKey(new Date())))
  ]);
  const selected=selectedMonth(),current=new Date(),m=monthTotals(tx,selected),cm=monthTotals(tx,current),goal=goalSnap.exists()?goalSnap.data():null;
  const reserve=pos.filter(p=>p.type==='reserve').reduce((s,p)=>s+Number(p.value||0),0),assets=pos.filter(p=>['asset','reserve'].includes(p.type)).reduce((s,p)=>s+Number(p.value||0),0),debts=pos.filter(p=>p.type==='debt').reduce((s,p)=>s+Number(p.value||0),0);
  const recurringMonthly=recurring.filter(r=>recurringValidInMonth(r,current)).reduce((s,r)=>s+Number(r.amount||0),0);
  const reserveTarget=recurringMonthly*6,reserveMonths=recurringMonthly>0?reserve/recurringMonthly:null,reserveProgress=reserveTarget>0?clamp(reserve/reserveTarget,0,1):null;

  if(m.income>0){const rate=(m.balance/m.income)*100;setText('#savingRate',`${rate.toFixed(1)}%`);setText('#savingStatus','(receitas − despesas) ÷ receitas');}
  else{setText('#savingRate','—');setText('#savingStatus','Sem receita lançada no mês');}

  if(recurringMonthly>0){setText('#reserveMonths',`${reserveMonths.toFixed(1)} / 6 meses`);setText('#reserveValue',`${currency.format(reserve)} de ${currency.format(reserveTarget)}`);const pct=reserveProgress*100;setText('#freedomPercent',`${pct.toFixed(0)}%`);document.querySelector('#freedomRing')?.style.setProperty('--p',`${pct}%`);setText('#freedomTarget',currency.format(reserveTarget));setText('#freedomGap',currency.format(Math.max(0,reserveTarget-reserve)));setText('#freedomBadge',`Reserva ${reserveMonths.toFixed(1)}/6 meses`);}
  else{setText('#reserveMonths','—');setText('#reserveValue','Cadastre despesas recorrentes');setText('#freedomPercent','—');document.querySelector('#freedomRing')?.style.setProperty('--p','0%');setText('#freedomTarget','—');setText('#freedomGap','—');setText('#freedomBadge','Reserva ainda não calculável');}

  if(pos.length===0){setText('#debtValue','—');setText('#debtRatio','Cadastre patrimônio e dívidas');}
  else if(debts===0){setText('#debtValue',currency.format(0));setText('#debtRatio','Nenhuma dívida cadastrada');}
  else{setText('#debtValue',currency.format(debts));setText('#debtRatio',assets>0?`${(debts/assets*100).toFixed(1)}% dos ativos cadastrados`:'Sem ativos para comparação');}

  const surplusGoal=Number(goal?.monthlySurplusGoal||0),dailyGoal=Number(goal?.dailySpendGoal||0),dailyAvg=cm.expense/Math.max(1,current.getDate());
  const measures=[];
  const vitals=[];
  if(surplusGoal>0&&cm.rows.length>0){const score=clamp(cm.balance/surplusGoal,0,1);measures.push({score,weight:35});vitals.push(['Sobra',`${Math.round(score*100)}%`]);}else vitals.push(['Sobra','—']);
  if(dailyGoal>0&&cm.expense>0){const score=clamp(dailyGoal/dailyAvg,0,1);measures.push({score,weight:25});vitals.push(['Gasto diário',dailyAvg<=dailyGoal?'Dentro':'Acima']);}else vitals.push(['Gasto diário','—']);
  if(recurringMonthly>0){const score=reserveProgress;measures.push({score,weight:25});vitals.push(['Reserva',`${reserveMonths.toFixed(1)}/6`]);}else vitals.push(['Reserva','—']);
  if(pos.length>0){let score;if(debts===0)score=1;else if(assets>0)score=clamp(1-debts/assets,0,1);else score=0;measures.push({score,weight:15});vitals.push(['Dívidas',debts===0?'Nenhuma':currency.format(debts)]);}else vitals.push(['Dívidas','—']);

  const totalWeight=measures.reduce((s,x)=>s+x.weight,0),health=totalWeight?Math.round(measures.reduce((s,x)=>s+x.score*x.weight,0)/totalWeight):null;
  const vit=document.querySelector('#petVitals');if(vit)vit.innerHTML=vitals.map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health??0}%`;
  const hb=document.querySelector('#petHealthBadge');if(hb){hb.textContent=health===null?'Saúde —':`Saúde ${health}%`;hb.className=`health-badge ${health===null?'warn':health>=70?'good':health>=45?'warn':'bad'}`;}
  let avatar='🐷',state='Aguardando dados',msg='Cadastre metas, despesas recorrentes e patrimônio para eu avaliar sua saúde financeira.';
  if(health!==null){if(health>=85){avatar='🐷✨';state='Radiante';msg='Sua estrutura financeira está bem protegida.';}else if(health>=70){state='Saudável';msg='Boa estrutura. Continue cumprindo as metas do mês.';}else if(health>=50){avatar='🐽';state='Em atenção';msg='Há pontos financeiros que precisam de atenção.';}else{avatar='😵‍💫';state='Crítico';msg='Priorize caixa, reserva e controle de compromissos.';}}
  setText('#petAvatar',avatar);setText('#petName',`Cofrinho · ${state}`);setText('#petMessage',msg);
  setText('#financeScore',health===null?'—':String(health));document.querySelector('#scoreRing')?.style.setProperty('--p',`${health??0}%`);setText('#scoreLabel',health===null?'Aguardando dados':health>=85?'Excelente':health>=70?'Forte':health>=50?'Em evolução':'Atenção');setText('#scoreHint',health===null?'Sem pontuação artificial: faltam dados para calcular.':'Score calculado apenas com indicadores que possuem dados válidos.');

  const missions=document.querySelector('#missionsList');if(missions){const items=[];if(surplusGoal>0)items.push(['💰','Sobra mensal',cm.rows.length?`${currency.format(cm.balance)} / ${currency.format(surplusGoal)}`:'Sem lançamentos no mês',cm.rows.length?clamp(cm.balance/surplusGoal,0,1):0]);if(dailyGoal>0)items.push(['🧭','Gasto diário',cm.expense>0?`${currency.format(dailyAvg)} / ${currency.format(dailyGoal)}`:'Sem despesas lançadas',cm.expense>0?clamp(dailyGoal/dailyAvg,0,1):0]);items.push(['🛟','Reserva de emergência',recurringMonthly>0?`${currency.format(reserve)} / ${currency.format(reserveTarget)}`:'Cadastre despesas recorrentes',reserveProgress??0]);missions.innerHTML=items.map(([i,n,d,p])=>`<div class="mission ${p>=1?'done':''}"><div class="mission-icon">${i}</div><div><strong>${n}</strong><p>${d}</p><div class="mission-progress"><i style="width:${p*100}%"></i></div></div></div>`).join('');}
}

window.addEventListener('load',()=>{
  const app=getApp(),auth=getAuth(app),db=getFirestore(app);let current=null;relabelStaticUI();
  const refresh=()=>current&&refreshIntegrity(db,current).catch(console.warn);
  onAuthStateChanged(auth,u=>{current=u;if(u){setTimeout(refresh,1400);setTimeout(refresh,2600)}});
  const label=document.querySelector('#monthLabel');if(label)new MutationObserver(()=>setTimeout(refresh,120)).observe(label,{childList:true,characterData:true,subtree:true});
  document.addEventListener('submit',()=>setTimeout(refresh,1200));
  document.addEventListener('click',e=>{if(e.target.closest('[data-delete-tx],[data-delete-position],[data-del-rec],[data-edit-rec],[data-go],#prevMonth,#nextMonth'))setTimeout(refresh,1200)});
});
