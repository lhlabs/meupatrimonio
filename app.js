import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const currency = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const monthFmt = new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"});
const categories = {
  expense:["Moradia","Mercado","Restaurantes","Transporte","Veículo","Saúde","Pets","Assinaturas","Lazer","Compras","Impostos","Seguros","Educação","Viagens","Outros"],
  income:["Salário","Benefícios","Renda extra","Investimentos","Reembolso","Venda","Outros"]
};

if (!firebaseConfig.projectId || firebaseConfig.projectId === "SUBSTITUA") {
  document.body.innerHTML = `<main style="max-width:680px;margin:60px auto;padding:24px;font-family:system-ui;color:#eee"><h1>Configuração do Firebase pendente</h1><p>Edite <code>firebase-config.js</code> com a configuração Web do seu projeto Firebase antes de publicar.</p></main>`;
  throw new Error("Firebase não configurado");
}

const app = initializeApp(firebaseConfig);
if (appCheckSiteKey) initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const auth = getAuth(app);
const db = getFirestore(app);
await setPersistence(auth,browserLocalPersistence);

let user = null;
let selectedMonth = new Date(); selectedMonth.setDate(1);
let txCache = [], positionsCache = [], settings = {};

function userCol(name){ return collection(db,"users",user.uid,name); }
function userDoc(name,id){ return doc(db,"users",user.uid,name,id); }
function toast(msg){ const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200); }
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function esc(s=""){return s.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function iconFor(cat){ const m={Moradia:"⌂",Mercado:"▣",Restaurantes:"◉",Transporte:"↗",Veículo:"◆",Saúde:"+",Pets:"♧",Assinaturas:"∞",Lazer:"☆",Compras:"▤",Impostos:"%",Seguros:"□",Educação:"▰",Viagens:"✈",Salário:"$",Benefícios:"◎",Investimentos:"↗"};return m[cat]||"•"; }

async function ensureUserRoot(){
  const ref=doc(db,"users",user.uid); const snap=await getDoc(ref);
  if(!snap.exists()) await setDoc(ref,{createdAt:serverTimestamp(),email:user.email},{merge:true});
}
async function loadAll(){ await ensureUserRoot(); await Promise.all([loadTransactions(),loadPositions(),loadSettings()]); renderAll(); }
async function loadTransactions(){
  const q=query(userCol("transactions"),orderBy("date","desc"));
  const snap=await getDocs(q); txCache=snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function loadPositions(){ const snap=await getDocs(query(userCol("positions"),orderBy("createdAt","desc"))); positionsCache=snap.docs.map(d=>({id:d.id,...d.data()})); }
async function loadSettings(){ const snap=await getDoc(userDoc("config","planning")); settings=snap.exists()?snap.data():{}; }

function monthTransactions(){ const key=monthKey(selectedMonth); return txCache.filter(t=>String(t.date||"").startsWith(key)); }
function calcMonth(){ const txs=monthTransactions(); const income=txs.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount||0),0); const expense=txs.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount||0),0); return {txs,income,expense,balance:income-expense,savingRate:income?((income-expense)/income)*100:0}; }
function calcPositions(){ const assets=positionsCache.filter(p=>["asset","reserve"].includes(p.type)).reduce((s,p)=>s+Number(p.value||0),0); const reserve=positionsCache.filter(p=>p.type==="reserve").reduce((s,p)=>s+Number(p.value||0),0); const debts=positionsCache.filter(p=>p.type==="debt").reduce((s,p)=>s+Number(p.value||0),0); return {assets,reserve,debts,netWorth:assets-debts}; }

function renderAll(){ renderDashboard();renderTransactions();renderPositions();renderPlanning(); }
function renderDashboard(){
  $("#monthLabel").textContent=monthFmt.format(selectedMonth).replace(/^./,c=>c.toUpperCase());
  const m=calcMonth(),p=calcPositions();
  $("#monthBalance").textContent=currency.format(m.balance);$("#monthIncome").textContent=currency.format(m.income);$("#monthExpense").textContent=currency.format(m.expense);$("#savingRate").textContent=`${m.savingRate.toFixed(1)}%`;
  $("#netWorth").textContent=currency.format(p.netWorth);$("#reserveValue").textContent=currency.format(p.reserve);$("#debtValue").textContent=currency.format(p.debts);
  const avgExpense=rollingAverageExpenses(); const reserveMonths=avgExpense?p.reserve/avgExpense:0; $("#reserveMonths").textContent=`${reserveMonths.toFixed(1)} meses de despesas`;
  const freedomMonthly=Number(settings.financialFreedomMonthlyCost||0); const target=freedomMonthly?freedomMonthly*12/0.04:0; const fp=target?Math.max(0,Math.min(100,p.netWorth/target*100)):0; $("#freedomPercent").textContent=`${fp.toFixed(1)}%`; $("#freedomLabel").textContent=target?`Meta: ${currency.format(target)}`:"Meta ainda não definida";
  const cats={};m.txs.filter(t=>t.type==="expense").forEach(t=>cats[t.category]=(cats[t.category]||0)+Number(t.amount)); const rows=Object.entries(cats).sort((a,b)=>b[1]-a[1]); const max=rows[0]?.[1]||1;
  $("#categoryBars").className="bars"; $("#categoryBars").innerHTML=rows.length?rows.map(([c,v])=>`<div class="bar-row"><span>${esc(c)}</span><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div><b>${currency.format(v)}</b></div>`).join(""):`<div class="empty-state">Sem despesas neste mês.</div>`;
  $("#recentTransactions").className="list";$("#recentTransactions").innerHTML=m.txs.slice(0,5).map(txRow).join("")||`<div class="empty-state">Nenhum lançamento ainda.</div>`;
}
function txRow(t){ return `<div class="list-row"><div class="list-icon">${iconFor(t.category)}</div><div class="list-main"><strong>${esc(t.description||t.category)}</strong><small>${esc(t.category)} · ${formatDate(t.date)}</small></div><div><div class="money ${t.type}">${t.type==="expense"?"−":"+"}${currency.format(Number(t.amount||0))}</div><div class="row-actions"><button class="mini-btn" data-delete-tx="${t.id}">Excluir</button></div></div></div>`; }
function formatDate(v){if(!v)return"";const [y,m,d]=v.split("-");return `${d}/${m}/${y}`;}
function renderTransactions(){ const type=$("#txTypeFilter").value,search=$("#txSearch").value.trim().toLowerCase(); let list=monthTransactions(); if(type!=="all")list=list.filter(t=>t.type===type);if(search)list=list.filter(t=>(t.description||"").toLowerCase().includes(search)||(t.category||"").toLowerCase().includes(search));$("#transactionsList").className="list";$("#transactionsList").innerHTML=list.map(txRow).join("")||`<div class="empty-state">Nenhum lançamento.</div>`; }
function renderPositions(){ const p=calcPositions();$("#assetsTotal").textContent=currency.format(p.assets);$("#debtsTotal").textContent=currency.format(p.debts);$("#positionsList").className="list";$("#positionsList").innerHTML=positionsCache.map(x=>`<div class="list-row"><div class="list-icon">${x.type==="debt"?"−":"+"}</div><div class="list-main"><strong>${esc(x.name)}</strong><small>${x.type==="debt"?"Dívida":x.type==="reserve"?"Reserva":"Ativo"}</small></div><div><div class="money ${x.type==="debt"?"expense":"income"}">${currency.format(Number(x.value||0))}</div><div class="row-actions"><button class="mini-btn" data-delete-position="${x.id}">Excluir</button></div></div></div>`).join("")||`<div class="empty-state">Nenhuma posição cadastrada.</div>`; }
function rollingAverageExpenses(){ const map={};txCache.filter(t=>t.type==="expense").forEach(t=>{const k=String(t.date||"").slice(0,7);if(/^\d{4}-\d{2}$/.test(k)) map[k]=(map[k]||0)+Number(t.amount||0)});const vals=Object.keys(map).sort().reverse().slice(0,6).map(k=>map[k]);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; }
function project(realRate,years,start,monthly){ const r=Math.pow(1+realRate/100,1/12)-1,n=years*12;return start*Math.pow(1+r,n)+(r?monthly*(Math.pow(1+r,n)-1)/r:monthly*n); }
function renderPlanning(){
  $("#monthlyContributionGoal").value=settings.monthlyContributionGoal??"";$("#financialFreedomMonthlyCost").value=settings.financialFreedomMonthlyCost??"";$("#realReturn").value=settings.realReturn??5;$("#reserveTargetMonths").value=settings.reserveTargetMonths??6;
  const p=calcPositions(),monthly=Number(settings.monthlyContributionGoal||Math.max(0,calcMonth().balance)),rate=Number(settings.realReturn??5);$("#projectionGrid").innerHTML=[5,10,20,30].map(y=>`<div class="projection-item"><span>${y} anos</span><strong>${currency.format(project(rate,y,p.netWorth,monthly))}</strong></div>`).join("");
  const avg=rollingAverageExpenses(),rm=avg?p.reserve/avg:0,targetMonths=Number(settings.reserveTargetMonths||6),m=calcMonth(),items=[];
  if(p.debts>0)items.push(`Dívidas registradas em <b>${currency.format(p.debts)}</b>. Compare o CET da dívida com o retorno líquido e sem risco dos investimentos antes de acelerar aportes.`);
  if(avg&&rm<targetMonths)items.push(`Reserva cobre <b>${rm.toFixed(1)} meses</b>; sua meta é ${targetMonths}. Prioridade: fortalecer liquidez antes de aumentar risco.`); else if(avg&&rm>=targetMonths)items.push(`Reserva de emergência está em nível compatível com sua meta de ${targetMonths} meses.`);
  if(m.income>0)items.push(`Taxa de poupança do mês: <b>${m.savingRate.toFixed(1)}%</b>. Quanto mais sustentável for esse percentual, mais curta tende a ser a jornada até a independência financeira.`);
  if(!items.length)items.push(`Cadastre receitas, despesas e posições patrimoniais para liberar o diagnóstico automático.`);
  $("#diagnosis").innerHTML=items.map(x=>`<div class="diagnosis-item">${x}</div>`).join("");
}
function fillCategories(type){$("#transactionCategory").innerHTML=categories[type].map(c=>`<option value="${c}">${c}</option>`).join("");}
function openTransaction(){fillCategories("expense");$("#transactionType").value="expense";$$('[data-tx-type]').forEach(b=>b.classList.toggle("selected",b.dataset.txType==="expense"));$("#transactionDate").value=ymd(new Date());$("#transactionAmount").value="";$("#transactionDescription").value="";$("#transactionRecurring").checked=false;$("#transactionDialog").showModal();setTimeout(()=>$("#transactionAmount").focus(),100);}
function switchPage(page){$$('.page').forEach(p=>p.classList.toggle('active',p.id===`${page}Section`));$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));if(page==="transactions")renderTransactions();}

$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();try{await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);toast("Acesso liberado");}catch(err){console.error(err);toast("E-mail ou senha inválidos");}});
$("#resetPasswordBtn").addEventListener("click",async()=>{const email=$("#email").value.trim();if(!email)return toast("Informe seu e-mail primeiro");try{await sendPasswordResetEmail(auth,email);toast("E-mail de redefinição enviado");}catch(e){console.error(e);toast("Não foi possível enviar agora");}});
$("#logoutBtn").addEventListener("click",()=>signOut(auth));
$("#quickAddBtn").addEventListener("click",openTransaction);$("#openTransactionBtn").addEventListener("click",openTransaction);
$$('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$$('[data-tx-type]').forEach(b=>b.addEventListener('click',()=>{const type=b.dataset.txType;$("#transactionType").value=type;fillCategories(type);$$('[data-tx-type]').forEach(x=>x.classList.toggle('selected',x===b));}));
$("#transactionForm").addEventListener("submit",async e=>{e.preventDefault();const amount=Number($("#transactionAmount").value);if(!(amount>0))return toast("Informe um valor válido");await addDoc(userCol("transactions"),{type:$("#transactionType").value,amount,category:$("#transactionCategory").value,description:$("#transactionDescription").value.trim(),date:$("#transactionDate").value,recurring:$("#transactionRecurring").checked,createdAt:serverTimestamp()});$("#transactionDialog").close();await loadTransactions();renderAll();toast("Lançamento salvo");});
$("#openPositionBtn").addEventListener("click",()=>{$("#positionForm").reset();$("#positionDialog").showModal();});
$("#positionForm").addEventListener("submit",async e=>{e.preventDefault();const value=Number($("#positionValue").value);if(value<0)return;await addDoc(userCol("positions"),{type:$("#positionType").value,name:$("#positionName").value.trim(),value,createdAt:serverTimestamp()});$("#positionDialog").close();await loadPositions();renderAll();toast("Posição salva");});
$("#planningForm").addEventListener("submit",async e=>{e.preventDefault();settings={monthlyContributionGoal:Number($("#monthlyContributionGoal").value||0),financialFreedomMonthlyCost:Number($("#financialFreedomMonthlyCost").value||0),realReturn:Number($("#realReturn").value||5),reserveTargetMonths:Number($("#reserveTargetMonths").value||6),updatedAt:serverTimestamp()};await setDoc(userDoc("config","planning"),settings,{merge:true});renderAll();toast("Planejamento atualizado");});
$("#prevMonth").addEventListener("click",()=>{selectedMonth.setMonth(selectedMonth.getMonth()-1);renderAll();});$("#nextMonth").addEventListener("click",()=>{selectedMonth.setMonth(selectedMonth.getMonth()+1);renderAll();});
$$('.nav-item').forEach(n=>n.addEventListener('click',()=>switchPage(n.dataset.page)));$$('[data-go]').forEach(n=>n.addEventListener('click',()=>switchPage(n.dataset.go)));$("#txTypeFilter").addEventListener("change",renderTransactions);$("#txSearch").addEventListener("input",renderTransactions);
document.addEventListener("click",async e=>{const tx=e.target.closest('[data-delete-tx]');if(tx&&confirm("Excluir este lançamento?")){await deleteDoc(userDoc("transactions",tx.dataset.deleteTx));await loadTransactions();renderAll();toast("Lançamento excluído");}const p=e.target.closest('[data-delete-position]');if(p&&confirm("Excluir esta posição?")){await deleteDoc(userDoc("positions",p.dataset.deletePosition));await loadPositions();renderAll();toast("Posição excluída");}});

onAuthStateChanged(auth,async u=>{
  user=u;
  if(u){$("#authView").classList.add("hidden");$("#appView").classList.remove("hidden");$("#greeting").textContent="Visão financeira";try{await loadAll();}catch(e){console.error(e);toast("Falha ao carregar seus dados");}}
  else{$("#appView").classList.add("hidden");$("#authView").classList.remove("hidden");}
});

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
