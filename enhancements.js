import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthNames = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const dueDateFor=(y,m,day)=>`${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(Number(day),new Date(y,m+1,0).getDate())).padStart(2,'0')}`;
const esc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let annualForecastEnabled=false;

function selectedMonth(){
  const text=norm(document.querySelector('#monthLabel')?.textContent||'');
  const mi=monthNames.findIndex(m=>text.includes(m));
  const ym=text.match(/(20\d{2})/);
  return new Date(ym?Number(ym[1]):new Date().getFullYear(),mi>=0?mi:new Date().getMonth(),1);
}
function selectedYear(){return Number(document.querySelector('#yearLabel')?.textContent)||new Date().getFullYear()}
async function col(db,uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function recurringDueInMonth(r,d){
  if(!r.active)return null;
  const due=dueDateFor(d.getFullYear(),d.getMonth(),r.dayOfMonth);
  if(r.startDate && due<r.startDate)return null;
  if(r.endDate && due>r.endDate)return null;
  return due;
}
function calcMonth(tx,d){const key=monthKey(d),rows=tx.filter(t=>String(t.date||'').startsWith(key)),income=rows.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0),expense=rows.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);return{rows,income,expense,balance:income-expense}}
function addYear(dateStr){const [y,m,d]=String(dateStr).split('-').map(Number),last=new Date(y+1,m,0).getDate();return `${y+1}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`}

async function materializeCurrentMonthRecurring(db,user){
  const now=new Date(),key=monthKey(now),[recurring,tx]=await Promise.all([col(db,user.uid,'recurring'),col(db,user.uid,'transactions')]);
  for(const r of recurring){
    const due=recurringDueInMonth(r,now);if(!due)continue;
    const id=`rec_${r.id}_${key}`;
    if(tx.some(t=>t.id===id || (t.sourceType==='recurring'&&t.sourceId===r.id&&String(t.date||'').startsWith(key))))continue;
    await setDoc(doc(db,'users',user.uid,'transactions',id),{type:r.type,amount:Number(r.amount||0),category:r.category,description:r.name||r.description||'',date:due,recurring:true,sourceType:'recurring',sourceId:r.id,createdAt:serverTimestamp()});
  }
}

function plannedForMonth(recurring,scheduled,tx,d){
  const key=monthKey(d),planned=[];
  recurring.forEach(r=>{const due=recurringDueInMonth(r,d);if(!due)return;const exists=tx.some(t=>t.sourceType==='recurring'&&t.sourceId===r.id&&String(t.date||'').startsWith(key));if(!exists)planned.push({name:r.name,amount:Number(r.amount||0),type:r.type,date:due,category:r.category,icon:'🔁',source:'recurring'});});
  scheduled.filter(s=>s.status==='active').forEach(s=>{
    let due=s.dueDate;
    if(s.frequency==='annual'){
      let guard=0;while(due && due.slice(0,7)<key && guard++<30)due=addYear(due);
    }
    if(!due||!due.startsWith(key))return;
    const exists=tx.some(t=>t.sourceType==='scheduled'&&t.sourceId===s.id&&String(t.date||'').startsWith(key));
    if(!exists)planned.push({name:s.name,amount:Number(s.amount||0),type:s.type,date:due,category:s.category,icon:'📅',source:'scheduled'});
  });
  return planned.sort((a,b)=>a.date.localeCompare(b.date));
}

async function refreshForecast(db,user){
  const target=selectedMonth(),key=monthKey(target);
  const [recurring,scheduled,tx]=await Promise.all([col(db,user.uid,'recurring'),col(db,user.uid,'scheduled'),col(db,user.uid,'transactions')]);
  const planned=plannedForMonth(recurring,scheduled,tx,target);
  let card=document.querySelector('#forecastCard');
  if(!card){card=document.createElement('article');card.id='forecastCard';card.className='panel';const anchor=document.querySelector('#dashboardSection .dashboard-grid');anchor?.parentNode.insertBefore(card,anchor);}
  const exp=planned.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0),inc=planned.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0);
  card.innerHTML=`<div class="panel-head"><div><span class="card-kicker">PREVISÃO DO MÊS</span><h2>Compromissos já conhecidos</h2></div><span class="subtle-pill">${planned.length} previstos</span></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0"><div style="padding:10px;border-radius:12px;background:#091724"><small style="color:#8fa2b8">Despesas previstas</small><strong style="display:block;margin-top:4px">${currency.format(exp)}</strong></div><div style="padding:10px;border-radius:12px;background:#091724"><small style="color:#8fa2b8">Receitas previstas</small><strong style="display:block;margin-top:4px">${currency.format(inc)}</strong></div></div>${planned.length?planned.slice(0,8).map(x=>`<div class="agenda-item"><div class="agenda-icon">${x.icon}</div><div><strong>${esc(x.name)}</strong><small>${x.date.split('-').reverse().join('/')}</small></div><b>${currency.format(x.amount)}</b></div>`).join(''):'<div class="muted">Nenhuma recorrência ou conta agendada prevista para este mês.</div>'}`;

  const today=ymd(new Date()),endD=new Date();endD.setDate(endD.getDate()+45);const end=ymd(endD),up=[];
  recurring.filter(r=>r.active).forEach(r=>{for(let i=0;i<3;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+i);const due=recurringDueInMonth(r,d);if(due&&due>=today&&due<=end){up.push({name:r.name,amount:r.amount,date:due,icon:'🔁'});break;}}});
  scheduled.filter(s=>s.status==='active').forEach(s=>{let due=s.dueDate,guard=0;while(s.frequency==='annual'&&due<today&&guard++<10)due=addYear(due);if(due>=today&&due<=end)up.push({name:s.name,amount:s.amount,date:due,icon:'📅'});});
  up.sort((a,b)=>a.date.localeCompare(b.date));const box=document.querySelector('#upcomingList');if(box)box.innerHTML=up.slice(0,5).map(x=>`<div class="agenda-item"><div class="agenda-icon">${x.icon}</div><div><strong>${esc(x.name)}</strong><small>${x.date.split('-').reverse().join('/')}</small></div><b>${currency.format(Number(x.amount||0))}</b></div>`).join('')||'<div class="muted">Nada nos próximos 45 dias.</div>';
  await refreshGoalCard(db,user,key,tx);
}

async function readMonthlyGoal(db,user,key){
  try{const s=await getDoc(doc(db,'users',user.uid,'monthlyGoals',key));return s.exists()?s.data():null}catch(e){console.warn('Metas mensais aguardando regras do Firestore',e);return null}
}
async function refreshGoalCard(db,user,key,tx=null){
  const goal=await readMonthlyGoal(db,user,key),d=new Date(Number(key.slice(0,4)),Number(key.slice(5,7))-1,1),rows=tx||await col(db,user.uid,'transactions'),m=calcMonth(rows,d),now=new Date(),elapsed=(d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth())?now.getDate():new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),daily=m.expense/Math.max(1,elapsed);
  const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v};
  if(!goal){set('#surplusGoalStatus','—');set('#surplusGoalDetail',`Sem meta para ${String(key).slice(5,7)}/${String(key).slice(0,4)}`);set('#dailyGoalStatus','—');set('#dailyGoalDetail','Defina a meta mensal em Metas');return}
  const sg=Number(goal.monthlySurplusGoal||0),dg=Number(goal.dailySpendGoal||0);set('#surplusGoalStatus',currency.format(m.balance));set('#surplusGoalDetail',`Meta ${currency.format(sg)} · ${m.balance>=sg?'atingida':'faltam '+currency.format(Math.max(0,sg-m.balance))}`);set('#dailyGoalStatus',currency.format(daily));set('#dailyGoalDetail',`Limite ${currency.format(dg)}/dia`);
}

async function refreshPet(db,user){
  const [tx,pos,settingsSnap]=await Promise.all([col(db,user.uid,'transactions'),col(db,user.uid,'positions'),getDoc(doc(db,'users',user.uid,'config','planning'))]);
  const s=settingsSnap.exists()?settingsSnap.data():{},now=new Date(),key=monthKey(now),monthTx=tx.filter(t=>String(t.date||'').startsWith(key)),goal=await readMonthlyGoal(db,user,key);
  const income=monthTx.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.amount||0),0),expense=monthTx.filter(t=>t.type==='expense').reduce((a,t)=>a+Number(t.amount||0),0),balance=income-expense,dailyAvg=expense/Math.max(1,now.getDate());
  const reserve=pos.filter(p=>p.type==='reserve').reduce((a,p)=>a+Number(p.value||0),0),assets=pos.filter(p=>['asset','reserve'].includes(p.type)).reduce((a,p)=>a+Number(p.value||0),0),debts=pos.filter(p=>p.type==='debt').reduce((a,p)=>a+Number(p.value||0),0);
  const monthly={};tx.filter(t=>t.type==='expense').forEach(t=>{const k=String(t.date||'').slice(0,7);if(/^\d{4}-\d{2}$/.test(k))monthly[k]=(monthly[k]||0)+Number(t.amount||0)});const vals=Object.keys(monthly).sort().reverse().slice(0,6).map(k=>monthly[k]),avgExpense=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0,reserveMonths=avgExpense?reserve/avgExpense:0;
  const surplusGoal=Number(goal?.monthlySurplusGoal||0),dailyGoal=Number(goal?.dailySpendGoal||0),reserveTarget=Number(s.reserveTargetMonths||6),debtRatio=assets?debts/assets:0;
  const parts={sobra:surplusGoal?(balance>=surplusGoal?1:balance>0?clamp(balance/surplusGoal,0,1):0):.25,diario:dailyGoal?(dailyAvg<=dailyGoal?1:clamp(dailyGoal/Math.max(dailyAvg,.01),0,1)):.25,reserva:clamp(reserveMonths/reserveTarget,0,1),divida:debtRatio<=.25?1:debtRatio<=.5?.55:.2,planejamento:(surplusGoal&&dailyGoal&&Number(s.monthlyContributionGoal||0)>0)?1:.35};
  const health=Math.round(parts.sobra*25+parts.diario*25+parts.reserva*20+parts.divida*15+parts.planejamento*15);
  let avatar='🐷',state='Cansado',msg='Defina as metas deste mês e cumpra-as para melhorar minha saúde.';if(health>=85){avatar='🐷✨';state='Radiante';msg='Metas e comportamento financeiro estão muito bem alinhados.'}else if(health>=70){state='Saudável';msg='Estou saudável. Continue protegendo sua sobra e o limite diário.'}else if(health>=50){avatar='🐽';state='Em atenção';msg='Algumas metas ainda precisam de atenção.'}else if(health<30){avatar='😵‍💫';state='Crítico';msg='Caixa, gastos ou segurança financeira precisam de prioridade.'}
  const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v};set('#petAvatar',avatar);set('#petName',`Cofrinho · ${state}`);set('#petMessage',msg);set('#petHealthBadge',`Saúde ${health}%`);const hb=document.querySelector('#petHealthBadge');if(hb)hb.className=`health-badge ${health>=70?'good':health>=45?'warn':'bad'}`;const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health}%`;
  const vit=document.querySelector('#petVitals');if(vit)vit.innerHTML=[['Sobra',surplusGoal?`${Math.round(parts.sobra*100)}%`:'sem meta'],['Gasto diário',dailyGoal?`${Math.round(parts.diario*100)}%`:'sem meta'],['Reserva',`${Math.round(parts.reserva*100)}%`],['Dívidas',`${Math.round(parts.divida*100)}%`]].map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
}

function annualSvg(rows){const max=Math.max(1,...rows.flatMap(r=>[r.income,r.expense])),w=720,h=230,pad=30,group=(w-pad*2)/rows.length,bw=Math.max(6,group*.23);return `<svg viewBox="0 0 ${w} ${h}" role="img">${rows.map((r,i)=>{const x=pad+i*group+group*.25,ih=r.income/max*(h-60),eh=r.expense/max*(h-60);return `<rect x="${x}" y="${h-30-ih}" width="${bw}" height="${ih}" rx="5" fill="#58d6a2"/><rect x="${x+bw+5}" y="${h-30-eh}" width="${bw}" height="${eh}" rx="5" fill="#ff7d86"/><text x="${x+group*.22}" y="${h-8}" fill="#8fa2b8" font-size="11" text-anchor="middle">${r.label}</text>`}).join('')}</svg>`}
async function refreshAnnual(db,user){
  const y=selectedYear(),[tx,recurring,scheduled]=await Promise.all([col(db,user.uid,'transactions'),col(db,user.uid,'recurring'),col(db,user.uid,'scheduled')]),rows=[],cats={};let income=0,expense=0;
  for(let m=0;m<12;m++){
    const d=new Date(y,m,1),actual=calcMonth(tx,d),planned=annualForecastEnabled?plannedForMonth(recurring,scheduled,tx,d):[],pi=planned.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0),pe=planned.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0),ri=actual.income+pi,re=actual.expense+pe;
    rows.push({label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),income:ri,expense:re,balance:ri-re,planned:planned.length});income+=ri;expense+=re;actual.rows.filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+Number(t.amount||0));planned.filter(x=>x.type==='expense').forEach(x=>cats[x.category]=(cats[x.category]||0)+x.amount);
  }
  const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v};set('#annualIncome',currency.format(income));set('#annualExpense',currency.format(expense));set('#annualBalance',currency.format(income-expense));set('#annualSavingRate',`${income?((income-expense)/income*100).toFixed(1):0}%`);const chart=document.querySelector('#annualChart');if(chart)chart.innerHTML=annualSvg(rows);
  const cr=Object.entries(cats).sort((a,b)=>b[1]-a[1]),max=cr[0]?.[1]||1,catBox=document.querySelector('#annualCategories');if(catBox)catBox.innerHTML=cr.slice(0,10).map(([c,v],i)=>`<div class="rank-item"><div><strong>${i+1}. ${esc(c)}</strong><small>${currency.format(v)}</small><div class="rank-bar"><i style="width:${v/max*100}%"></i></div></div><b>${expense?Math.round(v/expense*100):0}%</b></div>`).join('')||'<div class="muted">Sem dados.</div>';
  const monthBox=document.querySelector('#annualMonths');if(monthBox)monthBox.innerHTML=rows.map(r=>`<div class="month-item"><div><strong>${r.label.toUpperCase()}</strong><small>R ${currency.format(r.income)} · D ${currency.format(r.expense)}${annualForecastEnabled&&r.planned?` · ${r.planned} previsto(s)`:''}</small></div><b class="money ${r.balance>=0?'income':'expense'}">${currency.format(r.balance)}</b></div>`).join('');
  const pill=document.querySelector('#annualForecastStatus');if(pill)pill.textContent=annualForecastEnabled?'Realizado + previsto':'Somente realizado';
}

function installAnnualToggle(db,user){
  if(document.querySelector('#annualForecastToggle'))return;
  const section=document.querySelector('#annualSection .section-hero');if(!section)return;
  const wrap=document.createElement('div');wrap.id='annualForecastToggle';wrap.className='segmented';wrap.style.minWidth='290px';wrap.innerHTML='<button type="button" class="selected" data-annual-mode="actual">Realizado</button><button type="button" data-annual-mode="forecast">+ Previstos</button>';
  const badge=document.createElement('span');badge.id='annualForecastStatus';badge.className='subtle-pill';badge.textContent='Somente realizado';const holder=document.createElement('div');holder.style.display='grid';holder.style.gap='8px';holder.append(wrap,badge);section.appendChild(holder);
  wrap.addEventListener('click',e=>{const b=e.target.closest('[data-annual-mode]');if(!b)return;annualForecastEnabled=b.dataset.annualMode==='forecast';wrap.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));refreshAnnual(db,user).catch(console.warn)});
}

function installMonthlyGoalUI(db,user){
  if(document.querySelector('#monthlyGoalForm'))return;
  document.querySelector('#monthlySurplusGoal')?.closest('label')?.style.setProperty('display','none');document.querySelector('#dailySpendGoal')?.closest('label')?.style.setProperty('display','none');
  const planning=document.querySelector('#planningForm');if(!planning)return;
  const card=document.createElement('form');card.id='monthlyGoalForm';card.className='panel form-grid';card.innerHTML='<div style="grid-column:1/-1"><span class="card-kicker">METAS MENSAIS</span><h2 style="margin:4px 0 4px">Meta específica de cada mês</h2><p class="muted" style="margin:0">A sobra mínima e o limite diário podem mudar mês a mês. A meta de aporte continua na estratégia geral.</p></div><label>Mês<input id="monthlyGoalMonth" type="month" required /></label><label>Sobra mínima do mês<input id="monthlyGoalSurplus" type="number" min="0" step="50" required /></label><label>Limite médio de gasto diário<input id="monthlyGoalDaily" type="number" min="0" step="10" required /></label><div id="monthlyGoalFeedback" class="muted" style="align-self:end">Selecione o mês.</div><button class="primary" type="submit">Salvar metas deste mês</button>';
  planning.parentNode.insertBefore(card,planning);
  const mi=card.querySelector('#monthlyGoalMonth'),sur=card.querySelector('#monthlyGoalSurplus'),daily=card.querySelector('#monthlyGoalDaily'),feedback=card.querySelector('#monthlyGoalFeedback');mi.value=monthKey(new Date());
  const load=async()=>{const g=await readMonthlyGoal(db,user,mi.value);sur.value=g?.monthlySurplusGoal??'';daily.value=g?.dailySpendGoal??'';feedback.textContent=g?'Metas já cadastradas para este mês.':'Nenhuma meta cadastrada para este mês.'};
  mi.addEventListener('change',()=>load().catch(console.warn));card.addEventListener('submit',async e=>{e.preventDefault();const key=mi.value,ref=doc(db,'users',user.uid,'monthlyGoals',key),snap=await getDoc(ref),payload={month:key,monthlySurplusGoal:Number(sur.value||0),dailySpendGoal:Number(daily.value||0),createdAt:snap.exists()?snap.data().createdAt:serverTimestamp(),updatedAt:serverTimestamp()};await setDoc(ref,payload);feedback.textContent='Metas salvas.';await Promise.all([refreshPet(db,user),refreshGoalCard(db,user,monthKey(selectedMonth())),refreshAnnual(db,user)]);});
  load().catch(()=>{feedback.textContent='Publique as novas regras do Firestore para ativar metas mensais.'});
}

async function migrateLegacyMonthlyGoal(db,user){
  try{const key=monthKey(new Date()),ref=doc(db,'users',user.uid,'monthlyGoals',key),goal=await getDoc(ref);if(goal.exists())return;const p=await getDoc(doc(db,'users',user.uid,'config','planning'));if(!p.exists())return;const s=p.data(),sg=Number(s.monthlySurplusGoal||0),dg=Number(s.dailySpendGoal||0);if(!sg&&!dg)return;await setDoc(ref,{month:key,monthlySurplusGoal:sg,dailySpendGoal:dg,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})}catch(e){console.warn('Migração de metas mensais aguardando regras',e)}
}

window.addEventListener('load',()=>{
  const app=getApp(),auth=getAuth(app),db=getFirestore(app);let current=null;
  const refresh=async()=>{if(!current)return;await materializeCurrentMonthRecurring(db,current);await Promise.all([refreshPet(db,current),refreshForecast(db,current),refreshAnnual(db,current)])};
  onAuthStateChanged(auth,async u=>{current=u;if(!u)return;await migrateLegacyMonthlyGoal(db,u);installMonthlyGoalUI(db,u);installAnnualToggle(db,u);setTimeout(()=>refresh().catch(console.warn),700)});
  document.querySelector('#planningForm')?.addEventListener('submit',()=>{setTimeout(()=>current&&refreshPet(db,current),1000)});
  const label=document.querySelector('#monthLabel');if(label)new MutationObserver(()=>setTimeout(()=>current&&refreshForecast(db,current).catch(console.warn),60)).observe(label,{childList:true,characterData:true,subtree:true});
  const year=document.querySelector('#yearLabel');if(year)new MutationObserver(()=>setTimeout(()=>current&&refreshAnnual(db,current).catch(console.warn),60)).observe(year,{childList:true,characterData:true,subtree:true});
});
