import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, browserLocalPersistence, setPersistence
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDocs, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js";
import { firebaseConfig, appCheckSiteKey } from "../firebase-config.js";
import {
  CONTRIBUTION_CATEGORY, monthMetrics, periodSpendingMetrics, positionMetrics, safeNumber, ymd
} from "../finance-logic.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const currency = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const categories = {
  expense: ['Moradia','Mercado','Restaurantes','Transporte','Veículo','Saúde','Academia','Pets','Assinaturas','Lazer','Compras','Impostos','Seguros','Educação','Viagens',CONTRIBUTION_CATEGORY,'Outros'],
  income: ['Salário','Benefícios','Renda extra','Investimentos','Reembolso','Venda','Outros']
};

const keywordCategories = {
  expense: [
    ['Academia',['academia','gym','mensalidade academia']],
    ['Mercado',['mercado','supermercado','padaria','açougue','acougue','hortifruti']],
    ['Restaurantes',['almoço','almoco','jantar','restaurante','lanche','delivery','ifood','comida','café','cafe']],
    ['Transporte',['uber','99','taxi','táxi','ônibus','onibus','passagem','metrô','metro']],
    ['Veículo',['gasolina','combustível','combustivel','posto','pedágio','pedagio','estacionamento','óleo','oleo','pneu','oficina']],
    ['Moradia',['aluguel','condomínio','condominio','energia','luz','água','agua','internet','casa','telefone']],
    ['Saúde',['farmácia','farmacia','médico','medico','consulta','exame','dentista','remédio','remedio']],
    ['Pets',['pet','cachorro','gato','ração','racao','veterinário','veterinario']],
    ['Assinaturas',['netflix','spotify','prime','hbo','disney','assinatura','icloud']],
    ['Lazer',['cinema','bar','cerveja','festa','show','jogo','lazer']],
    ['Compras',['roupa','sapato','amazon','shopee','mercado livre','compra']],
    ['Impostos',['ipva','iptu','imposto','taxa']],
    ['Seguros',['seguro']],
    ['Educação',['curso','livro','faculdade','escola','educação','educacao']],
    ['Viagens',['viagem','hotel','airbnb','hospedagem','passagem aérea','passagem aerea']],
    [CONTRIBUTION_CATEGORY,['aporte','apliquei','investi','investimento']]
  ],
  income: [
    ['Salário',['salário','salario','ordenado','folha']],
    ['Benefícios',['benefício','beneficio','vale alimentação','vale refeição','vale alimentacao','vale refeicao']],
    ['Renda extra',['freela','freelance','renda extra','bico']],
    ['Investimentos',['rendimento','dividendo','juros','provento']],
    ['Reembolso',['reembolso']],
    ['Venda',['venda','vendi']]
  ]
};

const app = initializeApp(firebaseConfig);
if (appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.warn('App Check indisponível neste navegador.', error);
  }
}
const auth = getAuth(app);
const db = getFirestore(app);
try { await setPersistence(auth, browserLocalPersistence); }
catch (error) { console.warn('Persistência de login indisponível.', error); }

let user = null;
let txCache = [];
let positionsCache = [];
let recurringCache = [];
let parsed = null;
let lastCreatedId = '';
let installPrompt = null;
let saving = false;
let loading = false;
let lastResumeSync = 0;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function norm(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function userCol(name) { return collection(db, 'users', user.uid, name); }
function userDoc(name,id) { return doc(db, 'users', user.uid, name, id); }
function capitalize(value='') { return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''; }
function shiftDate(days) { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+days); return ymd(d); }

function parseMoney(raw) {
  let value = String(raw || '').replace(/\s/g,'').replace(/^R\$/i,'');
  if (value.includes(',') && value.includes('.')) value = value.replace(/\./g,'').replace(',','.');
  else if (value.includes(',')) value = value.replace(',','.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g,'');
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function extractAmount(text) {
  const match = String(text).match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})/i);
  if (!match) return { amount:0, token:'' };
  return { amount:parseMoney(match[1]), token:match[0] };
}
function inferType(text) {
  const n = norm(text);
  if (/^\s*\+/.test(text) || /\b(recebi|receita|entrou|entrada|caiu|ganhei|vendi|reembolso|pix recebido|salario|salário)\b/i.test(text)) return 'income';
  if (/^\s*-/.test(text) || /\b(gastei|gasto|paguei|pago|comprei|despesa|saiu|compra|debito|débito)\b/i.test(text)) return 'expense';
  if (/\b(salario|rendimento|dividendo|reembolso|venda|freela)\b/.test(n)) return 'income';
  return 'expense';
}
function inferDate(text) {
  const n = norm(text);
  if (n.includes('anteontem')) return shiftDate(-2);
  if (n.includes('ontem')) return shiftDate(-1);
  const match = text.match(/\b(\d{1,2})[\/]([01]?\d)(?:[\/](\d{2,4}))?\b/);
  if (match) {
    const now = new Date();
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const month = Number(match[2]), day = Number(match[1]);
    const date = new Date(year, month - 1, day, 12);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return ymd(date);
  }
  return shiftDate(0);
}
function inferCategory(text,type) {
  const n = norm(text);
  for (const [category, words] of keywordCategories[type]) {
    if (words.some(word => n.includes(norm(word)))) return category;
  }
  return 'Outros';
}
function inferDescription(text, amountToken, category) {
  let value = String(text || '')
    .replace(amountToken,' ')
    .replace(/r\$/ig,' ')
    .replace(/[+-]/g,' ')
    .replace(/\b(gastei|gasto|paguei|pago|comprei|despesa|recebi|receita|entrou|entrada|ganhei|vendi|pix recebido|hoje|ontem|anteontem)\b/ig,' ')
    .replace(/\b(no|na|nos|nas|de|do|da|dos|das|em|com|por)\b/ig,' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  if (!value || value.length < 2) value = category;
  return capitalize(value.slice(0,80));
}
function parseCommand(text) {
  const clean = String(text || '').trim();
  const { amount, token } = extractAmount(clean);
  if (!(amount > 0)) return null;
  const type = inferType(clean);
  const category = inferCategory(clean,type);
  return { type, amount, category, description:inferDescription(clean,token,category), date:inferDate(clean) };
}

function fillCategorySelect(type, selected='') {
  const select = $('#editCategory');
  select.innerHTML = categories[type].map(item => `<option value="${item.replace(/"/g,'&quot;')}">${item}</option>`).join('');
  select.value = categories[type].includes(selected) ? selected : 'Outros';
}
function renderParsed(result) {
  parsed = result;
  $('#parseEmpty').classList.toggle('hidden', !!result);
  $('#parseCard').classList.toggle('hidden', !result);
  if (!result) return;
  $('#previewType').textContent = result.type === 'income' ? 'Receita' : 'Despesa';
  $('#previewType').className = `type-pill ${result.type}`;
  $('#previewAmount').textContent = currency.format(result.amount);
  $('#editType').value = result.type;
  fillCategorySelect(result.type,result.category);
  $('#editDescription').value = result.description;
  $('#editDate').value = result.date;
}
function readEditedParsed() {
  if (!parsed) return null;
  return {
    type:$('#editType').value,
    amount:parsed.amount,
    category:$('#editCategory').value,
    description:$('#editDescription').value.trim().slice(0,80) || $('#editCategory').value,
    date:$('#editDate').value
  };
}

async function loadData() {
  if (!user || loading) return;
  loading = true;
  $('#syncBadge').textContent = 'Atualizando';
  try {
    const [txSnap, posSnap, recSnap] = await Promise.all([
      getDocs(userCol('transactions')),
      getDocs(userCol('positions')),
      getDocs(userCol('recurring'))
    ]);
    txCache = txSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    positionsCache = posSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    recurringCache = recSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    renderDashboard();
    renderRecent();
    lastResumeSync = Date.now();
    $('#syncBadge').textContent = 'Sincronizado';
  } finally {
    loading = false;
  }
}
function renderDashboard() {
  const now = new Date(); now.setDate(1);
  const metrics = monthMetrics(txCache,now,recurringCache);
  const spending = periodSpendingMetrics(txCache,recurringCache,now);
  const positions = positionMetrics(positionsCache,txCache,ymd(new Date()));
  $('#netWorth').textContent = currency.format(positions.netWorth);
  $('#netWorthDetail').textContent = `${currency.format(positions.assets)} em ativos − ${currency.format(positions.debts)} em dívidas`;
  $('#monthBalance').textContent = currency.format(metrics.balance);
  $('#monthIncome').textContent = currency.format(metrics.income);
  $('#monthExpense').textContent = currency.format(spending.totalExpenses);
}
function formatDate(value) {
  if (!value) return '';
  const [y,m,d] = String(value).split('-');
  return `${d}/${m}/${y}`;
}
function esc(value='') { return String(value).replace(/[&<>'"]/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function createdAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return safeNumber(value.seconds) * 1000 + safeNumber(value.nanoseconds) / 1000000;
}
function compareTransactions(a,b) {
  const createdOrder = createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt);
  if (createdOrder) return createdOrder;
  const dateOrder = String(b.date || '').localeCompare(String(a.date || ''));
  if (dateOrder) return dateOrder;
  return String(b.id || '').localeCompare(String(a.id || ''));
}
function renderRecent() {
  const rows = txCache.slice().sort(compareTransactions).slice(0,8);
  $('#recentList').innerHTML = rows.length ? rows.map(tx => `
    <div class="recent-row">
      <div class="recent-icon">${tx.type === 'income' ? '+' : '−'}</div>
      <div class="recent-main"><strong>${esc(tx.description || tx.category)}</strong><small>${esc(tx.category)} · ${formatDate(tx.date)}</small></div>
      <div class="money ${tx.type}">${tx.type === 'income' ? '+' : '−'}${currency.format(safeNumber(tx.amount))}</div>
    </div>`).join('') : '<div class="empty">Nenhum lançamento.</div>';
}

async function saveParsed() {
  if (saving || !user) return;
  const data = readEditedParsed();
  if (!data || !(data.amount > 0) || !['income','expense'].includes(data.type) || !data.category || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    toast('Revise o lançamento.'); return;
  }
  saving = true;
  $('#saveSmartBtn').disabled = true;
  try {
    const ref = await addDoc(userCol('transactions'), { ...data, recurring:false, createdAt:serverTimestamp() });
    lastCreatedId = ref.id;
    $('#undoBtn').classList.remove('hidden');
    $('#smartInput').value = '';
    renderParsed(null);
    await loadData();
    toast(`${data.type === 'income' ? 'Receita' : 'Despesa'} registrada: ${currency.format(data.amount)}`);
  } catch (error) {
    console.error(error);
    toast(error?.message?.toLowerCase().includes('permission') ? 'Operação bloqueada pela segurança.' : 'Não foi possível registrar.');
  } finally {
    saving = false;
    $('#saveSmartBtn').disabled = false;
  }
}
async function undoLast() {
  if (!lastCreatedId || !user) return;
  try {
    await deleteDoc(userDoc('transactions',lastCreatedId));
    lastCreatedId = '';
    $('#undoBtn').classList.add('hidden');
    await loadData();
    toast('Último lançamento desfeito.');
  } catch (error) {
    console.error(error); toast('Não foi possível desfazer.');
  }
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('Use o microfone do teclado para ditar.');
    $('#smartInput').focus();
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  $('#voiceBtn').classList.add('listening');
  recognition.onresult = event => {
    const text = event.results[0][0].transcript;
    $('#smartInput').value = text;
    renderParsed(parseCommand(text));
  };
  recognition.onerror = () => toast('Não consegui entender. Tente novamente.');
  recognition.onend = () => $('#voiceBtn').classList.remove('listening');
  recognition.start();
}

async function syncOnResume() {
  if (!user || saving || loading || Date.now() - lastResumeSync < 1200) return;
  try { await loadData(); }
  catch (error) { console.error('Falha ao sincronizar ao retomar.', error); }
}

$('#smartInput').addEventListener('input', event => renderParsed(parseCommand(event.target.value)));
$('#smartInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && parsed) { event.preventDefault(); saveParsed(); }
});
$('#editType').addEventListener('change', event => {
  const old = $('#editCategory').value;
  fillCategorySelect(event.target.value, categories[event.target.value].includes(old) ? old : 'Outros');
  parsed.type = event.target.value;
  $('#previewType').textContent = event.target.value === 'income' ? 'Receita' : 'Despesa';
  $('#previewType').className = `type-pill ${event.target.value}`;
});
$$('[data-example]').forEach(button => button.addEventListener('click', () => {
  $('#smartInput').value = button.dataset.example;
  renderParsed(parseCommand(button.dataset.example));
  $('#smartInput').focus();
}));
$('#voiceBtn').addEventListener('click', startVoice);
$('#saveSmartBtn').addEventListener('click', saveParsed);
$('#undoBtn').addEventListener('click', undoLast);
$('#logoutBtn').addEventListener('click', () => signOut(auth));
$$('[data-scroll]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.scroll === 'quick') $('#quickSection').scrollIntoView({behavior:'smooth',block:'start'});
  else window.scrollTo({top:0,behavior:'smooth'});
}));

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try { await signInWithEmailAndPassword(auth,$('#email').value.trim(),$('#password').value); }
  catch (error) { console.error(error); toast('E-mail ou senha inválidos.'); }
  finally { button.disabled = false; }
});
$('#resetPasswordBtn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) return toast('Informe seu e-mail primeiro.');
  try { await sendPasswordResetEmail(auth,email); toast('E-mail de redefinição enviado.'); }
  catch (error) { console.error(error); toast('Não foi possível enviar o e-mail.'); }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('#installBtn').classList.remove('hidden');
  $('#installHint').textContent = 'Este navegador permite instalar o app diretamente.';
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installBtn').classList.add('hidden');
});
window.addEventListener('focus', syncOnResume);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOnResume(); });

onAuthStateChanged(auth, async current => {
  user = current;
  $('#authView').classList.toggle('hidden',!!current);
  $('#appView').classList.toggle('hidden',!current);
  if (current) {
    try { await loadData(); }
    catch (error) { console.error(error); toast('Falha ao carregar seus dados.'); }
    const cmd = new URLSearchParams(location.search).get('cmd');
    if (cmd) {
      $('#smartInput').value = cmd.slice(0,120);
      renderParsed(parseCommand($('#smartInput').value));
      setTimeout(() => $('#quickSection').scrollIntoView({block:'start'}),100);
    }
  } else {
    txCache=[]; positionsCache=[]; recurringCache=[]; renderParsed(null);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker indisponível.',error));
}