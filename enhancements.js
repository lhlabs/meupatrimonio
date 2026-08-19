import { getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthNames = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dueDateFor=(y,m,day)=>`${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(Number(day),new Date(y,m+1,0).getDate())).padStart(2,'0')}`;
const esc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function selectedMonth(){
  const text=norm(document.querySelector('#monthLabel')?.textContent||'');
  const mi=monthNames.findIndex(m=>text.includes(m));
  const ym=text.match(/(20\d{2})/);
  return new Date(ym?Number(ym[1]):new Date().getFullYear(),mi>=0?mi:new Date().getMonth(),1);
}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
async function col(db,uid,name){const s=await getDocs(collection(db,'users',uid,name));return s.docs.map(d=>({id:d.id,...d.data()}))}
function recurringDueInMonth(r,d){
  if(!r.active)return null;
  const due=dueDateFor(d.getFullYear(),d.getMonth(),r.dayOfMonth);
  if(r.startDate && due<r.startDate)return null;
  if(r.endDate && due>r.endDate)return null;
  return due;
}

async function refreshForecast(db,user){
  const target=selectedMonth(), key=monthKey(target);
  const [recurring,scheduled,tx]=await Promise.all([col(db,user.uid,'recurring'),col(db,user.uid,'scheduled'),col(db,user.uid,'transactions')]);
  const planned=[];
  recurring.forEach(r=>{const due=recurringDueInMonth(r,target);if(!due)return;const exists=tx.some(t=>t.sourceType==='recurring'&&t.sourceId===r.id&&String(t.date||'').startsWith(key));if(!exists)planned.push({name:r.name,amount:Number(r.amount||0),type:r.type,date:due,icon:'🔁'});});
  scheduled.filter(s=>s.status==='active'&&String(s.dueDate||'').startsWith(key)).forEach(s=>{const exists=tx.some(t=>t.sourceType==='scheduled'&&t.sourceId===s.id&&String(t.date||'').startsWith(key));if(!exists)planned.push({name:s.name,amount:Number(s.amount||0),type:s.type,date:s.dueDate,icon:'📅'});});
  planned.sort((a,b)=>a.date.localeCompare(b.date));
  let card=document.querySelector('#forecastCard');
  if(!card){card=document.createElement('article');card.id='forecastCard';card.className='panel';const anchor=document.querySelector('#dashboardSection .dashboard-grid');anchor?.parentNode.insertBefore(card,anchor);}
  const exp=planned.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0),inc=planned.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0);
  card.innerHTML=`<div class="panel-head"><div><span class="card-kicker">PREVISÃO DO MÊS</span><h2>Compromissos já conhecidos</h2></div><span class="subtle-pill">${planned.length} previstos</span></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0"><div style="padding:10px;border-radius:12px;background:#091724"><small style="color:#8fa2b8">Despesas previstas</small><strong style="display:block;margin-top:4px">${currency.format(exp)}</strong></div><div style="padding:10px;border-radius:12px;background:#091724"><small style="color:#8fa2b8">Receitas previstas</small><strong style="display:block;margin-top:4px">${currency.format(inc)}</strong></div></div>${planned.length?planned.slice(0,8).map(x=>`<div class="agenda-item"><div class="agenda-icon">${x.icon}</div><div><strong>${esc(x.name)}</strong><small>${x.date.split('-').reverse().join('/')}</small></div><b>${currency.format(x.amount)}</b></div>`).join(''):'<div class="muted">Nenhuma recorrência ou conta agendada prevista para este mês.</div>'}`;

  const today=ymd(new Date()),endD=new Date();endD.setDate(endD.getDate()+45);const end=ymd(endD),up=[];
  recurring.filter(r=>r.active).forEach(r=>{for(let i=0;i<3;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+i);const due=recurringDueInMonth(r,d);if(due&&due>=today&&due<=end){up.push({name:r.name,amount:r.amount,date:due,icon:'🔁'});break;}}});
  scheduled.filter(s=>s.status==='active'&&s.dueDate>=today&&s.dueDate<=end).forEach(s=>up.push({name:s.name,amount:s.amount,date:s.dueDate,icon:'📅'}));
  up.sort((a,b)=>a.date.localeCompare(b.date));const box=document.querySelector('#upcomingList');if(box)box.innerHTML=up.slice(0,5).map(x=>`<div class="agenda-item"><div class="agenda-icon">${x.icon}</div><div><strong>${esc(x.name)}</strong><small>${x.date.split('-').reverse().join('/')}</small></div><b>${currency.format(Number(x.amount||0))}</b></div>`).join('')||'<div class="muted">Nada nos próximos 45 dias.</div>';
}

async function refreshPet(db,user){
  const [tx,pos,settingsSnap]=await Promise.all([col(db,user.uid,'transactions'),col(db,user.uid,'positions'),getDoc(doc(db,'users',user.uid,'config','planning'))]);
  const s=settingsSnap.exists()?settingsSnap.data():{},now=new Date(),key=monthKey(now),monthTx=tx.filter(t=>String(t.date||'').startsWith(key));
  const income=monthTx.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.amount||0),0),expense=monthTx.filter(t=>t.type==='expense').reduce((a,t)=>a+Number(t.amount||0),0),balance=income-expense,dailyAvg=expense/Math.max(1,now.getDate());
  const reserve=pos.filter(p=>p.type==='reserve').reduce((a,p)=>a+Number(p.value||0),0),assets=pos.filter(p=>['asset','reserve'].includes(p.type)).reduce((a,p)=>a+Number(p.value||0),0),debts=pos.filter(p=>p.type==='debt').reduce((a,p)=>a+Number(p.value||0),0);
  const monthly={};tx.filter(t=>t.type==='expense').forEach(t=>{const k=String(t.date||'').slice(0,7);if(/^\d{4}-\d{2}$/.test(k))monthly[k]=(monthly[k]||0)+Number(t.amount||0)});const vals=Object.keys(monthly).sort().reverse().slice(0,6).map(k=>monthly[k]),avgExpense=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0,reserveMonths=avgExpense?reserve/avgExpense:0;
  const surplusGoal=Number(s.monthlySurplusGoal||0),dailyGoal=Number(s.dailySpendGoal||0),reserveTarget=Number(s.reserveTargetMonths||6),debtRatio=assets?debts/assets:0;
  const parts={sobra:surplusGoal?(balance>=surplusGoal?1:balance>0?clamp(balance/surplusGoal,0,1):0):.4,diario:dailyGoal?(dailyAvg<=dailyGoal?1:clamp(dailyGoal/Math.max(dailyAvg,.01),0,1)):.4,reserva:clamp(reserveMonths/reserveTarget,0,1),divida:debtRatio<=.25?1:debtRatio<=.5?.55:.2,planejamento:(surplusGoal&&dailyGoal)?1:.3};
  const health=Math.round(parts.sobra*25+parts.diario*25+parts.reserva*20+parts.divida*15+parts.planejamento*15);
  let avatar='🐷',state='Cansado',msg='Defina e cumpra metas para melhorar minha saúde.';if(health>=85){avatar='🐷✨';state='Radiante';msg='Metas e comportamento financeiro estão muito bem alinhados.'}else if(health>=70){state='Saudável';msg='Estou saudável. Continue protegendo sua sobra e o limite diário.'}else if(health>=50){avatar='🐽';state='Em atenção';msg='Algumas metas ainda precisam de atenção.'}else if(health<30){avatar='😵‍💫';state='Crítico';msg='Caixa, gastos ou segurança financeira precisam de prioridade.'}
  const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v};set('#petAvatar',avatar);set('#petName',`Cofrinho · ${state}`);set('#petMessage',msg);set('#petHealthBadge',`Saúde ${health}%`);const hb=document.querySelector('#petHealthBadge');if(hb)hb.className=`health-badge ${health>=70?'good':health>=45?'warn':'bad'}`;const bar=document.querySelector('#petHealthBar');if(bar)bar.style.width=`${health}%`;
  const vit=document.querySelector('#petVitals');if(vit)vit.innerHTML=[['Sobra',surplusGoal?`${Math.round(parts.sobra*100)}%`:'sem meta'],['Gasto diário',dailyGoal?`${Math.round(parts.diario*100)}%`:'sem meta'],['Reserva',`${Math.round(parts.reserva*100)}%`],['Dívidas',`${Math.round(parts.divida*100)}%`]].map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  set('#surplusGoalStatus',surplusGoal?currency.format(balance):'—');set('#surplusGoalDetail',surplusGoal?`Meta atual: ${currency.format(surplusGoal)} · ${balance>=surplusGoal?'atingida':'faltam '+currency.format(Math.max(0,surplusGoal-balance))}`:'Defina no planejamento');set('#dailyGoalStatus',dailyGoal?currency.format(dailyAvg):'—');set('#dailyGoalDetail',dailyGoal?`Média atual · limite ${currency.format(dailyGoal)}/dia`:'Defina no planejamento');
}

window.addEventListener('load',()=>{
  const app=getApp(),auth=getAuth(app),db=getFirestore(app);let current=null;
  const refresh=()=>current&&Promise.all([refreshPet(db,current),refreshForecast(db,current)]).catch(console.warn);
  onAuthStateChanged(auth,u=>{current=u;if(u)setTimeout(refresh,700)});
  document.querySelector('#planningForm')?.addEventListener('submit',()=>{setTimeout(refresh,800);setTimeout(refresh,1800)});
  const label=document.querySelector('#monthLabel');if(label)new MutationObserver(()=>setTimeout(()=>current&&refreshForecast(db,current),50)).observe(label,{childList:true,characterData:true,subtree:true});
});
