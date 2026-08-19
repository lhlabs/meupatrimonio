import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const compact=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
const monthNames=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CONTRIBUTION='Investimentos/Aportes';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const ymd=d=>`${monthKey(d)}-${String(d.getDate()).padStart(2,'0')}`;
const dueDateFor=(y,m,day)=>`${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(Number(day),new Date(y,m+1,0).getDate())).padStart(2,'0')}`;
const esc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let annualForecast=false;
let currentUser=null;
let refreshTimer=null;

async function col(db,uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function selectedMonth(){const text=norm(document.querySelector('#monthLabel')?.textContent||'');const mi=monthNames.findIndex(m=>text.includes(m));const ym=text.match(/(20\d{2})/);return new Date(ym?Number(ym[1]):new Date().getFullYear(),mi>=0?mi:new Date().getMonth(),1)}
function selectedYear(){return Number(document.querySelector('#yearLabel')?.textContent)||new Date().getFullYear()}
function setText(sel,val){const e=document.querySelector(sel);if(e)e.textContent=val}
function isContribution(x){const c=norm(x?.category);return x?.type==='expense'&&(c.includes('aporte')||c.includes('investimento'))}
function monthRows(tx,d){const k=monthKey(d);return tx.filter(t=>String(t.date||'').startsWith(k))}
function monthMetrics(tx,d){const rows=monthRows(tx,d),income=rows.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0),contribution=rows.filter(isContribution).reduce((s,t)=>s+Number(t.amount||0),0),consumption=rows.filter(t=>t.type==='expense'&&!isContribution(t)).reduce((s,t)=>s+Number(t.amount||0),0);return{rows,income,contribution,consumption,totalOut:contribution+consumption,balance:income-contribution-consumption}}
function recurringDue(r,d){if(!r?.active)return null;const due=dueDateFor(d.getFullYear(),d.getMonth(),r.dayOfMonth);if(r.startDate&&due<r.startDate)return null;if(r.endDate&&due>r.endDate)return null;return due}
function recurringForReserve(r,today){if(!r||r.active!==true||r.type!=='expense'||isContribution(r))return false;if(r.endDate&&r.endDate<today)return false;return Number(r.amount||0)>0}
function addYear(s){const [y,m,d]=String(s).split('-').map(Number),last=new Date(y+1,m,0).getDate();return `${y+1}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`}

function injectContributionCategory(){
  for(const [typeSel,catSel] of [['#transactionType','#transactionCategory'],['#recurringType','#recurringCategory'],['#scheduledType','#scheduledCategory']]){
    const type=document.querySelector(typeSel),cat=document.querySelector(catSel);if(!type||!cat||type.value!=='expense')continue;
    if(![...cat.options].some(o=>o.value===CONTRIBUTION))cat.add(new Option(CONTRIBUTION,CONTRIBUTION));
  }
}

function relabelBaseUI(){
  const saving=document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');if(saving)saving.textContent='Taxa de aporte';
  const debt=document.querySelector('#debtValue')?.closest('.mini-metric')?.querySelector('span');if(debt)debt.textContent='Dívidas cadastradas';
  const freedom=document.querySelector('.freedom-card');if(freedom){const k=freedom.querySelector('.card-kicker'),h=freedom.querySelector('h2');if(k)k.textContent='RESERVA DE EMERGÊNCIA';if(h)h.textContent='Cobertura da reserva';}
  const small=document.querySelector('#freedomPercent')?.parentElement?.querySelector('small');if(small)small.textContent='da meta de 6 meses';
  const tl=document.querySelector('#freedomTarget')?.parentElement?.querySelector('span');if(tl)tl.textContent='Meta 6× recorrentes';
  const gl=document.querySelector('#freedomGap')?.parentElement?.querySelector('span');if(gl)gl.textContent='Falta';
  const goalCard=document.querySelector('.goal-card');if(goalCard){const h=goalCard.querySelector('h2');if(h)h.textContent='Metas financeiras do mês';const s=goalCard.querySelectorAll('.goal-grid > div > span');if(s[0])s[0].textContent='Meta de aporte';if(s[1])s[1].textContent='Limite de gastos';}
  const oldSurplus=document.querySelector('#monthlySurplusGoal')?.closest('label');if(oldSurplus)oldSurplus.style.display='none';
  const oldDaily=document.querySelector('#dailySpendGoal')?.closest('label');if(oldDaily)oldDaily.style.display='none';
  const ff=document.querySelector('#financialFreedomMonthlyCost')?.closest('label');if(ff)ff.style.display='none';
  const reserveTarget=document.querySelector('#reserveTargetMonths');if(reserveTarget){reserveTarget.value='6';reserveTarget.disabled=true;const l=reserveTarget.closest('label');if(l&&l.childNodes[0])l.childNodes[0].textContent='Reserva-alvo — 6 meses';}
}

async function readGoal(db,uid,key){try{const s=await getDoc(doc(db,'users',uid,'monthlyGoals',key));return s.exists()?s.data():null}catch{return null}}

function installMonthlyGoalUI(db,user){
  if(document.querySelector('#monthlyGoalForm'))return;
  const planning=document.querySelector('#planningForm');if(!planning)return;
  const card=document.createElement('form');card.id='monthlyGoalForm';card.className='panel form-grid';
  card.innerHTML='<div style="grid-column:1/-1"><span class="card-kicker">METAS MENSAIS</span><h2 style="margin:4px 0">Aporte e gastos do mês</h2><p class="muted" style="margin:0">Defina quanto pretende aportar e o limite máximo de gastos de consumo em cada mês.</p></div><label>Mês<input id="monthlyGoalMonth" type="month" required></label><label>Meta de aporte do mês<input id="monthlyGoalContribution" type="number" min="0" step="50" required></label><label>Limite de gastos do mês<input id="monthlyGoalSpend" type="number" min="0" step="50" required></label><div id="monthlyGoalFeedback" class="muted" style="align-self:end"></div><button class="primary" type="submit">Salvar metas deste mês</button>';
  planning.parentNode.insertBefore(card,planning);
  const mi=card.querySelector('#monthlyGoalMonth'),cg=card.querySelector('#monthlyGoalContribution'),sg=card.querySelector('#monthlyGoalSpend'),fb=card.querySelector('#monthlyGoalFeedback');mi.value=monthKey(new Date());
  const load=async()=>{const g=await readGoal(db,user.uid,mi.value);cg.value=g?.monthlySurplusGoal??'';sg.value=g?.dailySpendGoal??'';fb.textContent=g?'Metas cadastradas para este mês.':'Nenhuma meta cadastrada para este mês.'};
  mi.addEventListener('change',()=>load().catch(console.warn));
  card.addEventListener('submit',async e=>{e.preventDefault();const key=mi.value,ref=doc(db,'users',user.uid,'monthlyGoals',key),snap=await getDoc(ref);await setDoc(ref,{month:key,monthlySurplusGoal:Number(cg.value||0),dailySpendGoal:Number(sg.value||0),createdAt:snap.exists()?snap.data().createdAt:serverTimestamp(),updatedAt:serverTimestamp()});fb.textContent='Metas salvas.';scheduleRefresh(db,80)});
  load().catch(()=>fb.textContent='Não foi possível carregar as metas.');
}

async function materializeCurrentMonthRecurring(db,user){
  const now=new Date(),key=monthKey(now),[recurring,tx]=await Promise.all([col(db,user.uid,'recurring'),col(db,user.uid,'transactions')]);
  for(const r of recurring){const due=recurringDue(r,now);if(!due)continue;const id=`rec_${r.id}_${key}`;if(tx.some(t=>t.id===id||(t.sourceType==='recurring'&&t.sourceId===r.id&&String(t.date||'').startsWith(key))))continue;await setDoc(doc(db,'users',user.uid,'transactions',id),{type:r.type,amount:Number(r.amount||0),category:r.category,description:r.name||r.description||'',date:due,recurring:true,sourceType:'recurring',sourceId:r.id,createdAt:serverTimestamp()});}
}

function plannedForMonth(recurring,scheduled,tx,d){
  const key=monthKey(d),out=[];
  recurring.forEach(r=>{const due=recurringDue(r,d);if(!due)return;const exists=tx.some(t=>t.sourceType==='recurring'&&t.sourceId===r.id&&String(t.date||'').startsWith(key));if(!exists)out.push({name:r.name,amount:Number(r.amount||0),type:r.type,date:due,category:r.category,icon:'🔁'});});
  scheduled.filter(s=>s.status==='active').forEach(s=>{let due=s.dueDate;if(s.frequency==='annual'){let g=0;while(due&&due.slice(0,7)<key&&g++<30)due=addYear(due)}if(!due||!due.startsWith(key))return;const exists=tx.some(t=>t.sourceType==='scheduled'&&t.sourceId===s.id&&String(t.date||'').startsWith(key));if(!exists)out.push({name:s.name,amount:Number(s.amount||0),type:s.type,date:due,category:s.category,icon:'📅'});});
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}

function renderForecast(recurring,scheduled,tx){
  const target=selectedMonth(),planned=plannedForMonth(recurring,scheduled,tx,target);let card=document.querySelector('#forecastCard');
  if(!card){card=document.createElement('article');card.id='forecastCard';card.className='panel';const anchor=document.querySelector('#dashboardSection .dashboard-grid');anchor?.parentNode.insertBefore(card,anchor)}
  const exp=planned.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0),inc=planned.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0);
  card.innerHTML=`<div class="panel-head"><div><span class="card-kicker">PREVISÃO DO MÊS</span><h2>Compromissos já conhecidos</h2></div><span class="subtle-pill">${planned.length} previstos</span></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0"><div style="padding:10px;border-radius:12px;background:#091724"><small class="muted">Despesas previstas</small><strong style="display:block">${currency.format(exp)}</strong></div><div style="padding:10px;border-radius:12px;background:#091724"><small class="muted">Receitas previstas</small><strong style="display:block">${currency.format(inc)}</strong></div></div>${planned.length?planned.slice(0,8).map(x=>`<div class="agenda-item"><div class="agenda-icon">${x.icon}</div><div><strong>${esc(x.name)}</strong><small>${x.date.split('-').reverse().join('/')}</small></div><b>${currency.format(x.amount)}</b></div>`).join(''):'<div class="muted">Nenhuma conta prevista para este mês.</div>'}`;
}

function installAnnualToggle(db){
  if(document.querySelector('#annualForecastToggle'))return;const hero=document.querySelector('#annualSection .section-hero');if(!hero)return;
  const box=document.createElement('div');box.id='annualForecastToggle';box.className='segmented';box.innerHTML='<button type="button" class="selected" data-mode="actual">Realizado</button><button type="button" data-mode="forecast">+ Previstos</button>';hero.appendChild(box);
  box.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;annualForecast=b.dataset.mode==='forecast';box.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));scheduleRefresh(db,60)});
}
function annualSvg(rows){const max=Math.max(1,...rows.flatMap(r=>[r.income,r.expense])),w=720,h=230,pad=30,group=(w-pad*2)/rows.length,bw=Math.max(6,group*.23);return `<svg viewBox="0 0 ${w} ${h}">${rows.map((r,i)=>{const x=pad+i*group+group*.25,ih=r.income/max*(h-60),eh=r.expense/max*(h-60);return `<rect x="${x}" y="${h-30-ih}" width="${bw}" height="${ih}" rx="5" fill="#58d6a2"/><rect x="${x+bw+5}" y="${h-30-eh}" width="${bw}" height="${eh}" rx="5" fill="#ff7d86"/><text x="${x+group*.22}" y="${h-8}" fill="#8fa2b8" font-size="11" text-anchor="middle">${r.label}</text>`}).join('')}</svg>`}
function renderAnnual(recurring,scheduled,tx){
  if(!document.querySelector('#annualSection.active'))return;const y=selectedYear(),rows=[],cats={};let income=0,expense=0;
  for(let m=0;m<12;m++){const d=new Date(y,m,1),actual=monthMetrics(tx,d),planned=annualForecast?plannedForMonth(recurring,scheduled,tx,d):[],pi=planned.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0),pe=planned.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0),ri=actual.income+pi,re=actual.totalOut+pe;rows.push({label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),income:ri,expense:re,balance:ri-re});income+=ri;expense+=re;actual.rows.filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+Number(t.amount||0));planned.filter(x=>x.type==='expense').forEach(x=>cats[x.category]=(cats[x.category]||0)+x.amount)}
  setText('#annualIncome',currency.format(income));setText('#annualExpense',currency.format(expense));setText('#annualBalance',currency.format(income-expense));setText('#annualSavingRate',income?`${((income-expense)/income*100).toFixed(1)}%`:'—');const ch=document.querySelector('#annualChart');if(ch)ch.innerHTML=annualSvg(rows);
  const cr=Object.entries(cats).sort((a,b)=>b[1]-a[1]),mx=cr[0]?.[1]||1,cb=document.querySelector('#annualCategories');if(cb)cb.innerHTML=cr.slice(0,10).map(([c,v],i)=>`<div class="rank-item"><div><strong>${i+1}. ${esc(c)}</strong><small>${currency.format(v)}</small><div class="rank-bar"><i style="width:${v/mx*100}%"></i></div></div><b>${expense?Math.round(v/expense*100):0}%</b></div>`).join('')||'<div class="muted">Sem dados.</div>';
  const mb=document.querySelector('#annualMonths');if(mb)mb.innerHTML=rows.map(r=>`<div class="month-item"><div><strong>${r.label.toUpperCase()}</strong><small>R ${compact.format(r.income)} · D ${compact.format(r.expense)}</small></div><b class="money ${r.balance>=0?'income':'expense'}">${currency.format(r.balance)}</b></div>`).join('');
}

async function refreshDashboard(db,user,data){
  const {tx,pos,recurring}=data,target=selectedMonth(),key=monthKey(target),goal=await readGoal(db,user.uid,key),m=monthMetrics(tx,target),today=ymd(new Date());
  const reserve=pos.filter(p=>p.type==='reserve').reduce((s,p)=>s+Number(p.value||0),0),debts=pos.filter(p=>p.type==='debt').reduce((s,p)=>s+Number(p.value||0),0),assets=pos.filter(p=>['asset','reserve'].includes(p.type)).reduce((s,p)=>s+Number(p.value||0),0);
  const recurringMonthly=recurring.filter(r=>recurringForReserve(r,today)).reduce((s,r)=>s+Number(r.amount||0),0),reserveTarget=recurringMonthly*6,reserveMonths=recurringMonthly?reserve/recurringMonthly:null,reserveProgress=reserveTarget?clamp(reserve/reserveTarget,0,1):null;
  const contributionGoal=Number(goal?.monthlySurplusGoal||0),spendGoal=Number(goal?.dailySpendGoal||0);

  setText('#savingRate',m.income?`${(m.contribution/m.income*100).toFixed(1)}%`:'—');setText('#savingStatus',m.income?`${currency.format(m.contribution)} aportados de ${currency.format(m.income)} recebidos`:'Sem receita lançada no mês');
  setText('#debtValue',pos.length?currency.format(debts):'—');setText('#debtRatio',pos.length?(debts?`${currency.format(debts)} de saldo devedor`:'Nenhuma dívida cadastrada'):'Cadastre patrimônio e dívidas');
  if(recurringMonthly){setText('#reserveMonths',`${reserveMonths.toFixed(1)} / 6 meses`);setText('#reserveValue',`${currency.format(reserve)} de ${currency.format(reserveTarget)}`);setText('#freedomPercent',`${Math.round(reserveProgress*100)}%`);document.querySelector('#freedomRing')?.style.setProperty('--p',`${reserveProgress*100}%`);setText('#freedomTarget',currency.format(reserveTarget));setText('#freedomGap',currency.format(Math.max(0,reserveTarget-reserve)));setText('#freedomBadge',`Reserva ${reserveMonths.toFixed(1)}/6 meses`)}else{setText('#reserveMonths','—');setText('#reserveValue','Nenhuma despesa recorrente ativa');setText('#freedomPercent','—');document.querySelector('#freedomRing')?.style.setProperty('--p','0%');setText('#freedomTarget','—');setText('#freedomGap','—');setText('#freedomBadge','Reserva não calculável')}

  setText('#surplusGoalStatus',currency.format(m.contribution));setText('#surplusGoalDetail',contributionGoal?`Meta ${currency.format(contributionGoal)} · ${m.contribution>=contributionGoal?'atingida':'faltam '+currency.format(contributionGoal-m.contribution)}`:'Defina a meta mensal em Metas');
  setText('#dailyGoalStatus',currency.format(m.consumption));setText('#dailyGoalDetail',spendGoal?`Limite ${currency.format(spendGoal)} · ${m.consumption<=spendGoal?'dentro do limite':'excesso de '+currency.format(m.consumption-spendGoal)}`:'Defina o limite mensal em Metas');

  const measures=[],vitals=[];
  if(contributionGoal>0){const s=clamp(m.contribution/contributionGoal,0,1);measures.push({s,w:40});vitals.push(['Aportes',`${Math.round(s*100)}%`])}else vitals.push(['Aportes','—']);
  if(spendGoal>0){const s=m.consumption<=spendGoal?1:clamp(spendGoal/Math.max(m.consumption,.01),0,1);measures.push({s,w:35});vitals.push(['Gastos',m.consumption<=spendGoal?'Dentro':'Acima'])}else vitals.push(['Gastos','—']);
  if(reserveProgress!==null){measures.push({s:reserveProgress,w:25});vitals.push(['Reserva',`${reserveMonths.toFixed(1)}/6`])}else vitals.push(['Reserva','—']);
  const tw=measures.reduce((s,x)=>s+x.w,0),health=tw?Math.round(measures.reduce((s,x)=>s+x.s*x.w,0)/tw):null;
  const pv=document.querySelector('#petVitals');if(pv)pv.innerHTML=vitals.map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');const hb=document.querySelector('#petHealthBadge');if(hb){hb.textContent=health===null?'Saúde —':`Saúde ${health}%`;hb.className=`health-badge ${health===null?'warn':health>=70?'good':health>=45?'warn':'bad'}`};const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health??0}%`;
  let avatar='🐷',state='Aguardando metas',msg='Defina meta de aporte, limite de gastos e mantenha sua reserva adequada.';if(health!==null){if(health>=85){avatar='🐷✨';state='Radiante';msg='Aportes, gastos e reserva estão muito bem alinhados.'}else if(health>=70){state='Saudável';msg='Boa disciplina financeira neste mês.'}else if(health>=50){avatar='🐽';state='Em atenção';msg='Uma das metas financeiras precisa de atenção.'}else{avatar='😵‍💫';state='Crítico';msg='Aportes, gastos ou reserva exigem correção.'}}
  setText('#petAvatar',avatar);setText('#petName',`Cofrinho · ${state}`);setText('#petMessage',msg);setText('#financeScore',health===null?'—':String(health));document.querySelector('#scoreRing')?.style.setProperty('--p',`${health??0}%`);setText('#scoreLabel',health===null?'Aguardando metas':health>=85?'Excelente':health>=70?'Forte':health>=50?'Em evolução':'Atenção');setText('#scoreHint',health===null?'Sem nota até existirem indicadores calculáveis.':'Score: aportes 40% + gastos 35% + reserva 25%.');

  const missions=document.querySelector('#missionsList');if(missions){const items=[['📈','Meta de aportes',contributionGoal?`${currency.format(m.contribution)} / ${currency.format(contributionGoal)}`:'Defina uma meta mensal',contributionGoal?clamp(m.contribution/contributionGoal,0,1):0],['🎯','Limite de gastos',spendGoal?`${currency.format(m.consumption)} / ${currency.format(spendGoal)}`:'Defina um limite mensal',spendGoal?(m.consumption<=spendGoal?1:clamp(spendGoal/Math.max(m.consumption,.01),0,1)):0],['🛟','Reserva de emergência',recurringMonthly?`${currency.format(reserve)} / ${currency.format(reserveTarget)}`:'Cadastre despesas recorrentes ativas',reserveProgress??0]];missions.innerHTML=items.map(([i,n,d,p])=>`<div class="mission ${p>=1?'done':''}"><div class="mission-icon">${i}</div><div><strong>${n}</strong><p>${d}</p><div class="mission-progress"><i style="width:${p*100}%"></i></div></div></div>`).join('')}
  const insights=document.querySelector('#insightsList');if(insights){const arr=[];if(contributionGoal)arr.push([m.contribution>=contributionGoal?'✅':'📈','Aportes',m.contribution>=contributionGoal?'Meta de aporte atingida.':`Faltam ${currency.format(Math.max(0,contributionGoal-m.contribution))} para a meta.`]);if(spendGoal)arr.push([m.consumption<=spendGoal?'✅':'⚠️','Gastos do mês',m.consumption<=spendGoal?`Você utilizou ${currency.format(m.consumption)} do limite de ${currency.format(spendGoal)}.`:`Gastos excedem o limite em ${currency.format(m.consumption-spendGoal)}.`]);arr.push(['🛟','Reserva',recurringMonthly?`Cobertura de ${reserveMonths.toFixed(1)} meses. Meta: 6 meses.`:'Cadastre despesas recorrentes para dimensionar a reserva.']);if(debts>0)arr.push(['📉','Dívidas',`Saldo devedor cadastrado: ${currency.format(debts)}.`]);insights.innerHTML=arr.map(x=>`<div class="insight"><div class="insight-icon">${x[0]}</div><div><strong>${x[1]}</strong><p>${x[2]}</p></div></div>`).join('')}
}

async function refreshAll(db){
  if(!currentUser)return;relabelBaseUI();injectContributionCategory();installMonthlyGoalUI(db,currentUser);installAnnualToggle(db);
  const [tx,pos,recurring,scheduled]=await Promise.all([col(db,currentUser.uid,'transactions'),col(db,currentUser.uid,'positions'),col(db,currentUser.uid,'recurring'),col(db,currentUser.uid,'scheduled')]);
  await refreshDashboard(db,currentUser,{tx,pos,recurring,scheduled});renderForecast(recurring,scheduled,tx);renderAnnual(recurring,scheduled,tx);injectContributionCategory();
}
function scheduleRefresh(db,delay=80){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshAll(db).catch(console.warn),delay)}

window.addEventListener('load',()=>{
  const app=getApp(),auth=getAuth(app),db=getFirestore(app);relabelBaseUI();
  onAuthStateChanged(auth,async u=>{currentUser=u;if(!u)return;try{await materializeCurrentMonthRecurring(db,u)}catch(e){console.warn('Recorrências:',e)}scheduleRefresh(db,700)});
  document.addEventListener('click',e=>{if(e.target.closest('.nav-item,[data-go],#prevMonth,#nextMonth,#prevYear,#nextYear,#quickAddBtn,#openTransactionBtn,#openRecurringBtn,#openScheduledBtn,[data-delete-tx],[data-delete-position],[data-del-rec],[data-del-sch],[data-edit-rec],[data-edit-sch]')){setTimeout(injectContributionCategory,0);scheduleRefresh(db,140)}});
  document.addEventListener('submit',()=>scheduleRefresh(db,650));
  document.querySelector('#transactionType')?.addEventListener('change',()=>setTimeout(injectContributionCategory,0));
  document.querySelector('#recurringType')?.addEventListener('change',()=>setTimeout(injectContributionCategory,0));
  document.querySelector('#scheduledType')?.addEventListener('change',()=>setTimeout(injectContributionCategory,0));
});
