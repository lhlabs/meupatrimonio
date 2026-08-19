import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, browserLocalPersistence, setPersistence
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs,
  deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import {
  CONTRIBUTION_CATEGORY, WITHDRAWAL_CATEGORY, addYear, clamp, contributionBalance,
  dailyVariableAverage, isContribution, isWithdrawal, monthKey, monthMetrics,
  nextRecurringDue, periodSpendingMetrics, positionMetrics, projectFutureValue,
  recurringDue, reserveMetrics, safeNumber, scoreMetrics, ymd
} from "./finance-logic.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const palette = ['#4fd1a3','#6ea8ff','#f7c65d','#ff7d86','#a78bfa','#5eead4','#fb923c','#94a3b8'];
const categories = {
  expense: ['Moradia','Mercado','Restaurantes','Transporte','Veículo','Saúde','Academia','Pets','Assinaturas','Lazer','Compras','Impostos','Seguros','Educação','Viagens',CONTRIBUTION_CATEGORY,'Outros'],
  income: ['Salário','Benefícios','Renda extra','Investimentos','Reembolso','Venda','Outros']
};

const app = initializeApp(firebaseConfig);
if (appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.warn('App Check não pôde ser inicializado neste navegador.', error);
  }
}

const auth = getAuth(app);
const db = getFirestore(app);
try { await setPersistence(auth, browserLocalPersistence); }
catch (error) { console.warn('Persistência local de login indisponível.', error); }

let user = null;
let selectedMonth = new Date(); selectedMonth.setDate(1);
let selectedYear = new Date().getFullYear();
let txCache = [];
let positionsCache = [];
let recurringCache = [];
let scheduledCache = [];
let monthlyGoalsCache = [];
let settings = {};
let agendaAvailable = true;
let annualForecast = false;
let actionBusy = false;

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}

function formatDate(value) {
  if (!value) return '';
  const [y,m,d] = String(value).split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(date) {
  return monthFmt.format(date).replace(/^./, char => char.toUpperCase());
}

function userCol(name) { return collection(db, 'users', user.uid, name); }
function userDoc(name, id) { return doc(db, 'users', user.uid, name, id); }
function goalFor(date = selectedMonth) {
  const key = monthKey(date);
  return monthlyGoalsCache.find(goal => goal.id === key || goal.month === key) || null;
}
function calcPositions() { return positionMetrics(positionsCache, txCache, ymd(new Date())); }
function timestampValue(value) { return value?.toMillis?.() ?? 0; }

async function runAction(button, task, successMessage) {
  if (actionBusy) return;
  actionBusy = true;
  const previousDisabled = button?.disabled;
  if (button) button.disabled = true;
  try {
    await task();
    if (successMessage) toast(successMessage);
  } catch (error) {
    console.error(error);
    toast(error?.message?.includes('permission')
      ? 'Operação bloqueada pelas regras de segurança.'
      : 'Não foi possível concluir. Tente novamente.');
  } finally {
    if (button) button.disabled = !!previousDisabled;
    actionBusy = false;
  }
}

function prepareUi() {
  const savingLabel = $('#savingRate')?.closest('.mini-metric')?.querySelector('span');
  if (savingLabel) savingLabel.textContent = 'Taxa de aporte líquido';
  const spendingLabel = $('#debtValue')?.closest('.mini-metric')?.querySelector('span');
  if (spendingLabel) spendingLabel.textContent = 'Gastos do período';

  const goalCard = $('.goal-card');
  if (goalCard) {
    const h = goalCard.querySelector('h2');
    if (h) h.textContent = 'Metas financeiras do mês';
    const labels = goalCard.querySelectorAll('.goal-grid > div > span');
    if (labels[0]) labels[0].textContent = 'Aporte líquido';
    if (labels[1]) labels[1].textContent = 'Gasto variável/dia';
  }

  const freedom = $('.freedom-card');
  if (freedom) {
    const kicker = freedom.querySelector('.card-kicker');
    if (kicker) kicker.textContent = 'RESERVA DE EMERGÊNCIA';
    const h = freedom.querySelector('h2');
    if (h) h.textContent = 'Cobertura';
    const small = $('#freedomPercent')?.parentElement?.querySelector('small');
    if (small) small.textContent = 'da meta';
    const labels = freedom.querySelectorAll('.freedom-stats span');
    if (labels[0]) labels[0].textContent = 'Meta';
    if (labels[1]) labels[1].textContent = 'Falta';
  }

  const chartLegend = $('#cashflowChart')?.parentElement?.querySelectorAll('.chart-legend span');
  if (chartLegend?.[1]) chartLegend[1].innerHTML = '<i class="dot expense-dot"></i>Gastos de consumo';
  const annualCards = $$('#annualSection .metric-strip .mini-metric > span');
  if (annualCards[1]) annualCards[1].textContent = 'Gastos no ano';
  if (annualCards[3]) annualCards[3].textContent = 'Taxa de aporte';

  ['monthlySurplusGoal','dailySpendGoal','financialFreedomMonthlyCost'].forEach(id => {
    const label = $('#'+id)?.closest('label');
    if (label) label.style.display = 'none';
  });
  const contributionLabel = $('#monthlyContributionGoal')?.closest('label');
  if (contributionLabel?.childNodes[0]) contributionLabel.childNodes[0].textContent = 'Aporte mensal de referência (projeções)';

  if (!$('#transactionEditId')) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.id = 'transactionEditId';
    $('#transactionForm')?.prepend(input);
  }
  if (!$('#positionEditId')) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.id = 'positionEditId';
    $('#positionForm')?.prepend(input);
  }
  const positionTitle = $('#positionDialog .dialog-head h2');
  if (positionTitle) positionTitle.id = 'positionDialogTitle';

  installMonthlyGoalForm();
  installAnnualToggle();
  ensureWithdrawalDialog();
}

function installMonthlyGoalForm() {
  if ($('#monthlyGoalForm') || !$('#planningForm')) return;
  const form = document.createElement('form');
  form.id = 'monthlyGoalForm';
  form.className = 'panel form-grid';
  form.innerHTML = `
    <div style="grid-column:1/-1"><span class="card-kicker">METAS MENSAIS</span><h2 style="margin:4px 0">Aporte e gasto diário</h2><p class="muted" style="margin:0">A meta de aporte mede quanto você transfere para patrimônio. O limite diário considera apenas gastos variáveis manuais, sem contas recorrentes, agendadas ou aportes.</p></div>
    <label>Mês<input id="monthlyGoalMonth" type="month" required></label>
    <label>Meta de aporte do mês<input id="monthlyGoalContribution" type="number" min="0" step="50" required></label>
    <label>Limite médio diário variável<input id="monthlyGoalDailySpend" type="number" min="0" step="5" required></label>
    <div id="monthlyGoalFeedback" class="muted" style="align-self:end"></div>
    <button class="primary" type="submit">Salvar metas deste mês</button>`;
  $('#planningForm').parentNode.insertBefore(form, $('#planningForm'));
  $('#monthlyGoalMonth').value = monthKey(new Date());
  $('#monthlyGoalMonth').addEventListener('change', loadMonthlyGoalForm);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    await runAction(button, async () => {
      const key = $('#monthlyGoalMonth').value;
      const contributionGoal = safeNumber($('#monthlyGoalContribution').value);
      const dailySpendGoal = safeNumber($('#monthlyGoalDailySpend').value);
      if (!/^\d{4}-\d{2}$/.test(key) || contributionGoal < 0 || dailySpendGoal < 0) throw new Error('Metas inválidas');
      const ref = userDoc('monthlyGoals', key);
      const snapshot = await getDoc(ref);
      await setDoc(ref, {
        month: key,
        monthlySurplusGoal: contributionGoal,
        dailySpendGoal,
        createdAt: snapshot.exists() ? snapshot.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await loadAll();
      $('#monthlyGoalMonth').value = key;
      loadMonthlyGoalForm();
    }, 'Metas do mês atualizadas');
  });
}

function loadMonthlyGoalForm() {
  const key = $('#monthlyGoalMonth')?.value;
  if (!key) return;
  const goal = monthlyGoalsCache.find(item => item.id === key || item.month === key);
  $('#monthlyGoalContribution').value = goal?.monthlySurplusGoal ?? '';
  $('#monthlyGoalDailySpend').value = goal?.dailySpendGoal ?? '';
  $('#monthlyGoalFeedback').textContent = goal ? 'Metas cadastradas para este mês.' : 'Nenhuma meta cadastrada para este mês.';
}

function installAnnualToggle() {
  if ($('#annualForecastToggle')) return;
  const hero = $('#annualSection .section-hero');
  if (!hero) return;
  const box = document.createElement('div');
  box.id = 'annualForecastToggle';
  box.className = 'segmented';
  box.innerHTML = '<button type="button" class="selected" data-annual-mode="actual">Realizado</button><button type="button" data-annual-mode="forecast">+ Previstos</button>';
  hero.appendChild(box);
  box.addEventListener('click', event => {
    const button = event.target.closest('[data-annual-mode]');
    if (!button) return;
    annualForecast = button.dataset.annualMode === 'forecast';
    box.querySelectorAll('button').forEach(item => item.classList.toggle('selected', item === button));
    renderAnnual();
  });
}

function ensureWithdrawalDialog() {
  if ($('#withdrawalDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'withdrawalDialog';
  dialog.innerHTML = `<form id="withdrawalForm" method="dialog" class="sheet-form">
    <div class="dialog-head"><div><span class="card-kicker">MOVIMENTAÇÃO PATRIMONIAL</span><h2>Mover aporte para saldo</h2></div><button type="button" class="icon-btn" id="closeWithdrawalDialog">×</button></div>
    <p class="muted" style="margin-top:0">O valor deixa o patrimônio formado por aportes e entra no saldo do mês. A movimentação não é tratada como renda.</p>
    <label>Valor<input id="withdrawalAmount" type="number" min="0.01" step="0.01" required></label>
    <label>Data<input id="withdrawalDate" type="date" required></label>
    <label>Descrição<input id="withdrawalDescription" maxlength="80" value="Resgate para saldo em conta"></label>
    <div id="withdrawalAvailable" class="muted"></div>
    <button class="primary" type="submit">Confirmar movimentação</button>
  </form>`;
  document.body.appendChild(dialog);
  $('#closeWithdrawalDialog').addEventListener('click', () => dialog.close());
  $('#withdrawalForm').addEventListener('submit', submitWithdrawal);
}

function openWithdrawal() {
  const today = ymd(new Date());
  const available = contributionBalance(txCache, today);
  if (!(available > 0)) return toast('Não há patrimônio por aportes disponível para movimentação.');
  $('#withdrawalAmount').value = '';
  $('#withdrawalAmount').max = String(available);
  $('#withdrawalDate').value = today;
  $('#withdrawalDate').max = today;
  $('#withdrawalAvailable').textContent = `Disponível hoje: ${currency.format(available)}`;
  $('#withdrawalDialog').showModal();
}

async function submitWithdrawal(event) {
  event.preventDefault();
  const button = event.submitter;
  await runAction(button, async () => {
    const amount = safeNumber($('#withdrawalAmount').value);
    const date = $('#withdrawalDate').value;
    const description = $('#withdrawalDescription').value.trim() || 'Resgate para saldo em conta';
    const today = ymd(new Date());
    if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error('Movimentação inválida');
    const available = contributionBalance(txCache, date);
    if (amount > available) throw new Error(`Valor acima do disponível (${currency.format(available)})`);
    await addDoc(userCol('transactions'), {
      type: 'income', amount, category: WITHDRAWAL_CATEGORY, description, date,
      recurring: false, createdAt: serverTimestamp()
    });
    $('#withdrawalDialog').close();
    await loadAll();
  }, 'Valor movido para o saldo do mês');
}

async function ensureUserRoot() {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { createdAt: serverTimestamp(), email: user.email });
}

async function loadCollection(name, sortField, direction = 'desc') {
  const snap = await getDocs(userCol(name));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!sortField) return rows;
  return rows.sort((a,b) => {
    const av = sortField === 'createdAt' ? timestampValue(a[sortField]) : String(a[sortField] ?? '');
    const bv = sortField === 'createdAt' ? timestampValue(b[sortField]) : String(b[sortField] ?? '');
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return direction === 'asc' ? cmp : -cmp;
  });
}

function buggyLegacyStartDate(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return '';
  const buggy = new Date(year, month, 1);
  const last = new Date(buggy.getFullYear(), buggy.getMonth() + 1, 0).getDate();
  buggy.setDate(Math.min(day, last));
  return ymd(buggy);
}

async function migrateLegacyRecurring() {
  const existing = new Set(recurringCache.map(item => item.id));
  for (const tx of txCache.filter(item => item.recurring === true && !item.sourceType)) {
    const id = `legacy_${tx.id}`;
    if (existing.has(id)) continue;
    const day = Number(String(tx.date).slice(8,10));
    await setDoc(userDoc('recurring', id), {
      name: tx.description || tx.category,
      type: tx.type,
      amount: safeNumber(tx.amount),
      category: tx.category,
      description: tx.description || '',
      dayOfMonth: day,
      startDate: tx.date,
      endDate: '',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    existing.add(id);
  }
}

async function repairLegacyRecurringStartDates() {
  const txById = new Map(txCache.map(tx => [tx.id, tx]));
  let changed = false;
  for (const recurring of recurringCache) {
    if (!String(recurring.id || '').startsWith('legacy_')) continue;
    const tx = txById.get(String(recurring.id).slice(7));
    if (!tx?.date) continue;
    const buggy = buggyLegacyStartDate(tx.date);
    if (recurring.startDate === buggy && recurring.startDate !== tx.date) {
      await updateDoc(userDoc('recurring', recurring.id), {
        startDate: tx.date,
        updatedAt: serverTimestamp()
      });
      changed = true;
    }
  }
  return changed;
}

async function processAutomations() {
  const today = ymd(new Date());
  const existingIds = new Set(txCache.map(item => item.id));

  for (const recurring of recurringCache.filter(item => item.active && item.startDate)) {
    const [year, month] = recurring.startDate.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    let cursor = new Date(year, month - 1, 1);
    let guard = 0;
    while (guard++ < 120) {
      const due = recurringDue(recurring, cursor);
      if (!due) {
        cursor.setMonth(cursor.getMonth() + 1);
        if (ymd(cursor) > today) break;
        continue;
      }
      if (due > today) break;
      const id = `rec_${recurring.id}_${due.slice(0,7)}`;
      if (!existingIds.has(id)) {
        await setDoc(userDoc('transactions', id), {
          type: recurring.type,
          amount: safeNumber(recurring.amount),
          category: recurring.category,
          description: recurring.name || recurring.description || '',
          date: due,
          recurring: true,
          sourceType: 'recurring',
          sourceId: recurring.id,
          createdAt: serverTimestamp()
        });
        existingIds.add(id);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  for (const scheduled of scheduledCache.filter(item => item.status === 'active' && item.dueDate)) {
    let due = scheduled.dueDate;
    let guard = 0;
    while (due && due <= today && guard++ < 20) {
      const id = scheduled.frequency === 'annual'
        ? `sched_${scheduled.id}_${due.slice(0,4)}`
        : `sched_${scheduled.id}`;
      if (!existingIds.has(id)) {
        await setDoc(userDoc('transactions', id), {
          type: scheduled.type,
          amount: safeNumber(scheduled.amount),
          category: scheduled.category,
          description: scheduled.name || scheduled.description || '',
          date: due,
          recurring: false,
          sourceType: 'scheduled',
          sourceId: scheduled.id,
          createdAt: serverTimestamp()
        });
        existingIds.add(id);
      }
      if (scheduled.frequency === 'annual') {
        due = addYear(due);
        if (!due) break;
        await updateDoc(userDoc('scheduled', scheduled.id), { dueDate: due, updatedAt: serverTimestamp() });
      } else {
        await updateDoc(userDoc('scheduled', scheduled.id), { status: 'posted', updatedAt: serverTimestamp() });
        break;
      }
    }
  }
}

async function loadAll() {
  await ensureUserRoot();
  const [transactions, positions, planning, monthlyGoals] = await Promise.all([
    loadCollection('transactions','date','desc'),
    loadCollection('positions','createdAt','desc'),
    getDoc(userDoc('config','planning')),
    loadCollection('monthlyGoals','month','desc')
  ]);
  txCache = transactions;
  positionsCache = positions;
  settings = planning.exists() ? planning.data() : {};
  monthlyGoalsCache = monthlyGoals;

  try {
    [recurringCache, scheduledCache] = await Promise.all([
      loadCollection('recurring','createdAt','desc'),
      loadCollection('scheduled','dueDate','asc')
    ]);
    agendaAvailable = true;
  } catch (error) {
    console.warn('Agenda indisponível.', error);
    recurringCache = [];
    scheduledCache = [];
    agendaAvailable = false;
  }

  if (agendaAvailable) {
    await migrateLegacyRecurring();
    recurringCache = await loadCollection('recurring','createdAt','desc');
    const repaired = await repairLegacyRecurringStartDates();
    if (repaired) recurringCache = await loadCollection('recurring','createdAt','desc');
    await processAutomations();
    [txCache, recurringCache, scheduledCache] = await Promise.all([
      loadCollection('transactions','date','desc'),
      loadCollection('recurring','createdAt','desc'),
      loadCollection('scheduled','dueDate','asc')
    ]);
  }

  renderAll();
  loadMonthlyGoalForm();
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderAnnual();
  renderAgenda();
  renderPositions();
  renderPlanning();
}

function renderDashboard() {
  const metrics = monthMetrics(txCache, selectedMonth);
  const positions = calcPositions();
  const goal = goalFor(selectedMonth);
  const prevDate = new Date(selectedMonth); prevDate.setMonth(prevDate.getMonth() - 1);
  const prev = monthMetrics(txCache, prevDate);
  const reserve = reserveMetrics({
    reserve: positions.reserve,
    transactions: txCache,
    recurring: recurringCache,
    todayYmd: ymd(new Date()),
    targetMonths: safeNumber(settings.reserveTargetMonths) || 6
  });
  const spending = periodSpendingMetrics(txCache, recurringCache, selectedMonth);
  const dailyAverage = dailyVariableAverage(txCache, selectedMonth);
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const dailyGoal = safeNumber(goal?.dailySpendGoal);
  const score = scoreMetrics({
    contribution: metrics.contribution,
    contributionGoal,
    dailyAverage,
    dailyGoal,
    reserveProgress: reserve.progress
  });

  $('#monthLabel').textContent = monthLabel(selectedMonth);
  $('#netWorth').textContent = currency.format(positions.netWorth);
  $('#netWorthContext').textContent = `${currency.format(positions.assets)} em ativos − ${currency.format(positions.debts)} em dívidas`;
  $('#monthBalance').textContent = currency.format(metrics.balance);
  $('#balanceTrend').textContent = prev.totalOut === 0 && prev.income === 0
    ? 'Sem base anterior'
    : `${metrics.balance >= prev.balance ? '▲' : '▼'} ${currency.format(Math.abs(metrics.balance - prev.balance))} vs. mês anterior`;
  $('#savingRate').textContent = metrics.contributionRate == null ? '—' : `${metrics.contributionRate.toFixed(1)}%`;
  if (metrics.income > 0) {
    $('#savingStatus').textContent = metrics.withdrawal > 0
      ? `Líquido ${currency.format(metrics.contribution)} · aportes ${currency.format(metrics.grossContribution)} · resgates ${currency.format(metrics.withdrawal)}`
      : `${currency.format(metrics.contribution)} aportados de ${currency.format(metrics.income)} recebidos`;
  } else {
    $('#savingStatus').textContent = metrics.withdrawal > 0
      ? `Resgate de ${currency.format(metrics.withdrawal)} para o saldo do mês`
      : 'Sem receita lançada no mês';
  }

  $('#debtValue').textContent = currency.format(spending.totalExpenses);
  $('#debtRatio').textContent = `${currency.format(spending.recurringExpenses)} recorrentes + ${currency.format(spending.otherExpenses)} demais`;

  if (reserve.progress != null) {
    const targetMonths = safeNumber(settings.reserveTargetMonths) || 6;
    $('#reserveMonths').textContent = `${reserve.months.toFixed(1)} / ${targetMonths} meses`;
    $('#reserveValue').textContent = `${currency.format(positions.reserve)} de ${currency.format(reserve.target)}`;
    $('#freedomPercent').textContent = `${Math.round(reserve.progress * 100)}%`;
    $('#freedomRing').style.setProperty('--p', `${reserve.progress * 100}%`);
    $('#freedomTarget').textContent = currency.format(reserve.target);
    $('#freedomGap').textContent = currency.format(Math.max(0, reserve.target - positions.reserve));
    $('#freedomBadge').textContent = `Reserva ${reserve.months.toFixed(1)} meses`;
  } else {
    $('#reserveMonths').textContent = '—';
    $('#reserveValue').textContent = recurringCache.some(item => item.active && item.type === 'expense')
      ? 'Revise datas das recorrências ativas'
      : 'Cadastre despesas recorrentes';
    $('#freedomPercent').textContent = '—';
    $('#freedomRing').style.setProperty('--p', '0%');
    $('#freedomTarget').textContent = '—';
    $('#freedomGap').textContent = '—';
    $('#freedomBadge').textContent = 'Reserva não calculável';
  }

  renderScoreAndPet(score, { metrics, goal, dailyAverage, reserve });
  renderCashflow();
  renderDonut(metrics);
  renderInsights(metrics, positions, goal, dailyAverage, reserve);
  renderMissions(metrics, goal, dailyAverage, reserve);
  renderForecast();
  renderUpcoming();
  $('#recentTransactions').innerHTML = metrics.rows.slice()
    .sort((a,b) => String(b.date).localeCompare(String(a.date)))
    .slice(0,6).map(txRow).join('') || '<div class="empty-state">Nenhum lançamento.</div>';
}

function renderScoreAndPet(score, context) {
  const { metrics, goal, dailyAverage, reserve } = context;
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const dailyGoal = safeNumber(goal?.dailySpendGoal);
  const health = score.score;
  $('#financeScore').textContent = health == null ? '—' : String(health);
  $('#scoreRing').style.setProperty('--p', `${health ?? 0}%`);
  $('#scoreLabel').textContent = health == null ? 'Aguardando metas' : health >= 85 ? 'Excelente' : health >= 70 ? 'Forte' : health >= 50 ? 'Em evolução' : 'Atenção';
  $('#scoreHint').textContent = health == null
    ? 'Defina meta de aporte e limite diário para calcular o score.'
    : `Score: aporte 40% + gasto diário 35%${reserve.progress != null ? ' + reserva 25%' : ''}${score.completeness < 100 ? ' · parcial' : ''}.`;
  const xp = Math.max(0, txCache.length * 2 + (health ?? 0) * 4 + (reserve.progress === 1 ? 200 : 0));
  $('#xpPill').textContent = `${Math.round(xp)} XP`;
  $('#levelPill').textContent = `Nível ${Math.max(1, Math.floor(xp / 500) + 1)}`;

  let avatar = '🐷', state = 'Aguardando metas', message = 'Defina suas metas mensais para eu avaliar sua disciplina financeira.';
  if (health != null) {
    if (health >= 85) { avatar = '🐷✨'; state = 'Radiante'; message = 'Aporte, gasto diário e reserva estão muito bem alinhados.'; }
    else if (health >= 70) { state = 'Saudável'; message = 'Boa disciplina. Mantenha o ritmo das metas.'; }
    else if (health >= 50) { avatar = '🐽'; state = 'Em atenção'; message = 'Uma das metas está pressionando sua saúde financeira.'; }
    else { avatar = '😵‍💫'; state = 'Crítico'; message = 'Aporte, gasto diário ou reserva precisam de correção.'; }
  }
  $('#petAvatar').textContent = avatar;
  $('#petName').textContent = `Cofrinho · ${state}`;
  $('#petMessage').textContent = message;
  $('#petHealthBadge').textContent = health == null ? 'Saúde —' : `Saúde ${health}%`;
  $('#petHealthBadge').className = `health-badge ${health == null ? 'warn' : health >= 70 ? 'good' : health >= 45 ? 'warn' : 'bad'}`;
  $('#petHealthBar').style.width = `${health ?? 0}%`;
  const vitals = [
    ['Aportes', contributionGoal ? `${Math.round(clamp(metrics.contribution / contributionGoal, 0, 1) * 100)}%` : '—'],
    ['Gasto/dia', dailyGoal ? `${currency.format(dailyAverage)} / ${currency.format(dailyGoal)}` : '—'],
    ['Reserva', reserve.months != null ? `${reserve.months.toFixed(1)} meses` : '—']
  ];
  $('#petVitals').innerHTML = vitals.map(([a,b]) => `<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  $('#surplusGoalStatus').textContent = currency.format(metrics.contribution);
  $('#surplusGoalDetail').textContent = contributionGoal
    ? `Meta ${currency.format(contributionGoal)} · ${metrics.contribution >= contributionGoal ? 'atingida' : 'faltam ' + currency.format(contributionGoal - metrics.contribution)}`
    : 'Defina a meta mensal em Metas';
  $('#dailyGoalStatus').textContent = currency.format(dailyAverage);
  $('#dailyGoalDetail').textContent = dailyGoal
    ? `Limite ${currency.format(dailyGoal)}/dia · ${dailyAverage <= dailyGoal ? 'dentro' : 'acima em ' + currency.format(dailyAverage - dailyGoal)}`
    : 'Defina o limite diário em Metas';
}

function txRow(tx) {
  const source = tx.sourceType === 'recurring' ? ' · recorrente' : tx.sourceType === 'scheduled' ? ' · agendada' : '';
  let actions = '';
  if (tx.sourceType) actions = '<span class="muted">Automático</span>';
  else if (isWithdrawal(tx)) actions = `<button class="mini-btn danger" data-delete-tx="${tx.id}">Excluir</button>`;
  else actions = `<button class="mini-btn" data-edit-tx="${tx.id}">Editar</button><button class="mini-btn danger" data-delete-tx="${tx.id}">Excluir</button>`;
  return `<div class="list-row"><div class="list-icon">${tx.type === 'expense' ? '−' : '+'}</div><div class="list-main"><strong>${esc(tx.description || tx.category)}</strong><small>${esc(tx.category)} · ${formatDate(tx.date)}${source}${isContribution(tx) ? ' · aporte' : ''}${isWithdrawal(tx) ? ' · resgate patrimonial' : ''}</small></div><div><div class="money ${tx.type}">${tx.type === 'expense' ? '−' : '+'}${currency.format(safeNumber(tx.amount))}</div><div class="row-actions">${actions}</div></div></div>`;
}

function renderTransactions() {
  const type = $('#txTypeFilter').value;
  const search = $('#txSearch').value.trim().toLowerCase();
  let list = monthMetrics(txCache, selectedMonth).rows.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));
  if (type !== 'all') list = list.filter(tx => tx.type === type);
  if (search) list = list.filter(tx => String(tx.description || '').toLowerCase().includes(search) || String(tx.category || '').toLowerCase().includes(search));
  $('#transactionsList').innerHTML = list.map(txRow).join('') || '<div class="empty-state">Nenhum lançamento.</div>';
}

function barSvg(rows) {
  const max = Math.max(1, ...rows.flatMap(r => [r.income, r.expense]));
  const w = 720, h = 230, pad = 30, group = (w - pad * 2) / rows.length, bw = Math.max(6, group * .23);
  return `<svg viewBox="0 0 ${w} ${h}" role="img">${rows.map((r,i) => {
    const x = pad + i * group + group * .25;
    const ih = r.income / max * (h - 60), eh = r.expense / max * (h - 60);
    return `<rect x="${x}" y="${h-30-ih}" width="${bw}" height="${ih}" rx="5" fill="#58d6a2"/><rect x="${x+bw+5}" y="${h-30-eh}" width="${bw}" height="${eh}" rx="5" fill="#ff7d86"/><text x="${x+group*.22}" y="${h-8}" fill="#8fa2b8" font-size="11" text-anchor="middle">${r.label}</text>`;
  }).join('')}</svg>`;
}

function renderCashflow() {
  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selectedMonth); d.setMonth(d.getMonth() - i);
    const m = monthMetrics(txCache, d);
    rows.push({ label: d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''), income: m.income, expense: m.consumption });
  }
  $('#cashflowChart').innerHTML = barSvg(rows);
}

function renderDonut(metrics) {
  const cats = {};
  metrics.rows.filter(tx => tx.type === 'expense' && !isContribution(tx)).forEach(tx => cats[tx.category] = (cats[tx.category] || 0) + safeNumber(tx.amount));
  const rows = Object.entries(cats).sort((a,b) => b[1] - a[1]);
  const total = metrics.consumption || 1;
  let pos = 0;
  const stops = [];
  rows.slice(0,8).forEach(([category,value],i) => {
    const end = pos + value / total * 100;
    stops.push(`${palette[i % palette.length]} ${pos}% ${end}%`);
    pos = end;
  });
  $('#expenseDonut').style.setProperty('--donut', rows.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#1c2e40 0 100%)');
  $('#expenseTotal').textContent = compact.format(metrics.consumption);
  $('#categoryLegend').innerHTML = rows.slice(0,6).map(([category,value],i) => `<div class="category-item"><i class="category-swatch" style="background:${palette[i % palette.length]}"></i><span>${esc(category)}</span><b>${currency.format(value)}</b></div>`).join('') || '<div class="muted">Sem gastos de consumo.</div>';
}

function renderInsights(metrics, positions, goal, dailyAverage, reserve) {
  const insights = [];
  const prev = new Date(selectedMonth); prev.setMonth(prev.getMonth() - 1);
  const previous = monthMetrics(txCache, prev);
  if (previous.consumption > 0) {
    const delta = (metrics.consumption - previous.consumption) / previous.consumption * 100;
    insights.push([delta <= 0 ? '📉' : '📈', 'Gastos vs. mês anterior', `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% de variação no consumo.`]);
  }
  const cats = {};
  metrics.rows.filter(tx => tx.type === 'expense' && !isContribution(tx)).forEach(tx => cats[tx.category] = (cats[tx.category] || 0) + safeNumber(tx.amount));
  const top = Object.entries(cats).sort((a,b) => b[1] - a[1])[0];
  if (top) insights.push(['🎯','Maior categoria',`${top[0]} representa ${(metrics.consumption ? top[1] / metrics.consumption * 100 : 0).toFixed(1)}% dos gastos.`]);
  insights.push(['🛟','Reserva', reserve.months != null ? `Cobertura de ${reserve.months.toFixed(1)} meses com base recorrente mensal de ${currency.format(reserve.monthlyBase)}.` : 'Ainda não há base recorrente válida para dimensionar a reserva.']);
  if (safeNumber(goal?.dailySpendGoal) > 0) insights.push([dailyAverage <= goal.dailySpendGoal ? '✅' : '⚠️','Gasto variável diário',`${currency.format(dailyAverage)}/dia vs. limite de ${currency.format(goal.dailySpendGoal)}.`]);
  if (positions.debts > 0) insights.push(['📉','Dívidas',`Saldo devedor cadastrado: ${currency.format(positions.debts)}.`]);
  $('#insightsList').innerHTML = insights.map(item => `<div class="insight"><div class="insight-icon">${item[0]}</div><div><strong>${item[1]}</strong><p>${item[2]}</p></div></div>`).join('');
}

function renderMissions(metrics, goal, dailyAverage, reserve) {
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const dailyGoal = safeNumber(goal?.dailySpendGoal);
  const targetMonths = safeNumber(settings.reserveTargetMonths) || 6;
  const missions = [
    ['📈','Meta de aportes', contributionGoal ? `${currency.format(metrics.contribution)} / ${currency.format(contributionGoal)}` : 'Defina uma meta mensal', contributionGoal ? clamp(metrics.contribution / contributionGoal,0,1) : 0],
    ['🎯','Gasto variável diário', dailyGoal ? `${currency.format(dailyAverage)} / ${currency.format(dailyGoal)} por dia` : 'Defina um limite diário', dailyGoal ? (dailyAverage <= dailyGoal ? 1 : clamp(dailyGoal / Math.max(dailyAverage,.01),0,1)) : 0],
    ['🛟','Reserva de emergência', reserve.target ? `${currency.format(calcPositions().reserve)} / ${currency.format(reserve.target)} (${targetMonths} meses)` : 'Cadastre recorrências ativas', reserve.progress ?? 0]
  ];
  $('#missionsList').innerHTML = missions.map(([icon,name,detail,pct]) => `<div class="mission ${pct >= 1 ? 'done' : ''}"><div class="mission-icon">${icon}</div><div><strong>${name}</strong><p>${detail}</p><div class="mission-progress"><i style="width:${pct * 100}%"></i></div></div></div>`).join('');
}

function plannedForMonth(date) {
  const key = monthKey(date), out = [];
  recurringCache.forEach(recurring => {
    const due = recurringDue(recurring, date);
    if (!due) return;
    const exists = txCache.some(tx => tx.sourceType === 'recurring' && tx.sourceId === recurring.id && String(tx.date || '').startsWith(key));
    if (!exists) out.push({ name: recurring.name, amount: safeNumber(recurring.amount), type: recurring.type, date: due, category: recurring.category, icon:'🔁', sourceType:'recurring', sourceId:recurring.id });
  });
  scheduledCache.filter(item => item.status === 'active').forEach(scheduled => {
    let due = scheduled.dueDate;
    if (!due) return;
    if (scheduled.frequency === 'annual') {
      let guard = 0;
      while (due.slice(0,7) < key && guard++ < 50) due = addYear(due);
    }
    if (!due || !due.startsWith(key)) return;
    const exists = txCache.some(tx => tx.sourceType === 'scheduled' && tx.sourceId === scheduled.id && String(tx.date || '').startsWith(key));
    if (!exists) out.push({ name: scheduled.name, amount: safeNumber(scheduled.amount), type: scheduled.type, date: due, category: scheduled.category, icon:'📅', sourceType:'scheduled', sourceId:scheduled.id });
  });
  return out.sort((a,b) => a.date.localeCompare(b.date));
}

function renderForecast() {
  const planned = plannedForMonth(selectedMonth);
  let card = $('#forecastCard');
  if (!card) {
    card = document.createElement('article');
    card.id = 'forecastCard';
    card.className = 'panel';
    const anchor = $('#dashboardSection .dashboard-grid');
    anchor?.parentNode.insertBefore(card, anchor);
  }
  const outgoing = planned.filter(item => item.type === 'expense').reduce((sum,item) => sum + item.amount, 0);
  const incoming = planned.filter(item => item.type === 'income').reduce((sum,item) => sum + item.amount, 0);
  card.innerHTML = `<div class="panel-head"><div><span class="card-kicker">PREVISÃO DO MÊS</span><h2>Compromissos ainda não realizados</h2></div><span class="subtle-pill">${planned.length} previstos</span></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0"><div style="padding:10px;border-radius:12px;background:#091724"><small class="muted">Saídas previstas</small><strong style="display:block">${currency.format(outgoing)}</strong></div><div style="padding:10px;border-radius:12px;background:#091724"><small class="muted">Receitas previstas</small><strong style="display:block">${currency.format(incoming)}</strong></div></div>${planned.length ? planned.slice(0,8).map(item => `<div class="agenda-item"><div class="agenda-icon">${item.icon}</div><div><strong>${esc(item.name)}</strong><small>${formatDate(item.date)}</small></div><b>${currency.format(item.amount)}</b></div>`).join('') : '<div class="muted">Nenhum compromisso pendente neste mês.</div>'}`;
}

function renderUpcoming() {
  if (!agendaAvailable) { $('#upcomingList').innerHTML = '<div class="muted">Agenda indisponível.</div>'; return; }
  const now = new Date(), today = ymd(now), limit = new Date(now);
  limit.setDate(limit.getDate() + 45);
  const end = ymd(limit), rows = [];
  scheduledCache.filter(item => item.status === 'active').forEach(item => {
    let due = item.dueDate;
    if (item.frequency === 'annual') {
      let guard = 0;
      while (due && due < today && guard++ < 50) due = addYear(due);
    }
    if (due && due >= today && due <= end) rows.push({ date: due, name: item.name, amount: item.amount, icon:'📅' });
  });
  recurringCache.filter(item => item.active).forEach(item => {
    const due = nextRecurringDue(item, now);
    if (due && due <= end) rows.push({ date: due, name: item.name, amount: item.amount, icon:'🔁' });
  });
  rows.sort((a,b) => a.date.localeCompare(b.date));
  $('#upcomingList').innerHTML = rows.slice(0,6).map(item => `<div class="agenda-item"><div class="agenda-icon">${item.icon}</div><div><strong>${esc(item.name)}</strong><small>${formatDate(item.date)}</small></div><b>${currency.format(safeNumber(item.amount))}</b></div>`).join('') || '<div class="muted">Nada nos próximos 45 dias.</div>';
}

function renderAnnual() {
  selectedYear = Number(selectedYear);
  $('#yearLabel').textContent = selectedYear;
  const rows = [], cats = {};
  let income = 0, consumption = 0, contribution = 0, balance = 0;
  for (let month = 0; month < 12; month++) {
    const date = new Date(selectedYear, month, 1);
    const actual = monthMetrics(txCache, date);
    const planned = annualForecast ? plannedForMonth(date) : [];
    const plannedIncome = planned.filter(item => item.type === 'income').reduce((sum,item) => sum + item.amount, 0);
    const plannedContribution = planned.filter(isContribution).reduce((sum,item) => sum + item.amount, 0);
    const plannedConsumption = planned.filter(item => item.type === 'expense' && !isContribution(item)).reduce((sum,item) => sum + item.amount, 0);
    const rowIncome = actual.income + plannedIncome;
    const rowConsumption = actual.consumption + plannedConsumption;
    const rowContribution = actual.contribution + plannedContribution;
    const rowBalance = rowIncome - rowConsumption - rowContribution;
    rows.push({ label: date.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''), income: rowIncome, expense: rowConsumption, balance: rowBalance, contribution: rowContribution });
    income += rowIncome; consumption += rowConsumption; contribution += rowContribution; balance += rowBalance;
    actual.rows.filter(tx => tx.type === 'expense' && !isContribution(tx)).forEach(tx => cats[tx.category] = (cats[tx.category] || 0) + safeNumber(tx.amount));
    planned.filter(item => item.type === 'expense' && !isContribution(item)).forEach(item => cats[item.category] = (cats[item.category] || 0) + item.amount);
  }
  $('#annualIncome').textContent = currency.format(income);
  $('#annualExpense').textContent = currency.format(consumption);
  $('#annualBalance').textContent = currency.format(balance);
  $('#annualSavingRate').textContent = income ? `${(contribution / income * 100).toFixed(1)}%` : '—';
  $('#annualChart').innerHTML = barSvg(rows);
  const ranked = Object.entries(cats).sort((a,b) => b[1] - a[1]), max = ranked[0]?.[1] || 1;
  $('#annualCategories').innerHTML = ranked.slice(0,10).map(([category,value],i) => `<div class="rank-item"><div><strong>${i+1}. ${esc(category)}</strong><small>${currency.format(value)}</small><div class="rank-bar"><i style="width:${value / max * 100}%"></i></div></div><b>${consumption ? Math.round(value / consumption * 100) : 0}%</b></div>`).join('') || '<div class="muted">Sem dados.</div>';
  $('#annualMonths').innerHTML = rows.map(row => `<div class="month-item"><div><strong>${row.label.toUpperCase()}</strong><small>R ${compact.format(row.income)} · G ${compact.format(row.expense)} · A ${compact.format(row.contribution)}</small></div><b class="money ${row.balance >= 0 ? 'income' : 'expense'}">${currency.format(row.balance)}</b></div>`).join('');
}

function renderAgenda() {
  if (!agendaAvailable) {
    $('#automationNotice').classList.remove('hidden');
    $('#automationNotice').textContent = 'As regras atuais não liberaram a agenda.';
    $('#recurringList').innerHTML = $('#scheduledList').innerHTML = '<div class="empty-state">Agenda indisponível.</div>';
    return;
  }
  $('#automationNotice').classList.add('hidden');
  $('#recurringCount').textContent = `${recurringCache.filter(item => item.active).length} ativas`;
  $('#scheduledCount').textContent = `${scheduledCache.filter(item => item.status === 'active').length} futuras`;
  $('#recurringList').innerHTML = recurringCache.map(item => `<div class="agenda-item ${item.active ? '' : 'inactive'}"><div class="agenda-icon">🔁</div><div><strong>${esc(item.name)}</strong><small>${currency.format(safeNumber(item.amount))} · dia ${item.dayOfMonth} · ${esc(item.category)}</small></div><div class="agenda-actions"><button class="mini-btn" data-edit-rec="${item.id}">Editar</button><button class="mini-btn danger" data-del-rec="${item.id}">Excluir</button></div></div>`).join('') || '<div class="empty-state">Nenhuma recorrência.</div>';
  $('#scheduledList').innerHTML = scheduledCache.map(item => `<div class="agenda-item ${item.status === 'active' ? '' : 'inactive'}"><div class="agenda-icon">📅</div><div><strong>${esc(item.name)}</strong><small>${currency.format(safeNumber(item.amount))} · ${formatDate(item.dueDate)} · ${item.frequency === 'annual' ? 'anual' : item.status === 'posted' ? 'lançada' : 'uma vez'}</small></div><div class="agenda-actions">${item.status === 'active' ? `<button class="mini-btn" data-edit-sch="${item.id}">Editar</button>` : ''}<button class="mini-btn danger" data-del-sch="${item.id}">Excluir</button></div></div>`).join('') || '<div class="empty-state">Nenhuma conta agendada.</div>';
}

function renderPositions() {
  const positions = calcPositions();
  $('#assetsTotal').textContent = currency.format(positions.assets);
  $('#debtsTotal').textContent = currency.format(positions.debts);
  $('#patrimonyNetWorth').textContent = currency.format(positions.netWorth);

  const hasContributionHistory = txCache.some(isContribution) || txCache.some(isWithdrawal);
  const autoRow = hasContributionHistory
    ? `<div class="list-row"><div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · aportes realizados menos resgates</small></div><div><div class="money income">${currency.format(positions.contributionAssets)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution ${positions.contributionAssets > 0 ? '' : 'disabled'}>Mover para saldo</button></div></div></div>`
    : '';
  const manualRows = positionsCache.map(item => `<div class="list-row"><div class="list-icon">${item.type === 'debt' ? '−' : '+'}</div><div class="list-main"><strong>${esc(item.name)}</strong><small>${item.type === 'debt' ? 'Dívida' : item.type === 'reserve' ? 'Reserva' : 'Ativo'}</small></div><div><div class="money ${item.type === 'debt' ? 'expense' : 'income'}">${currency.format(safeNumber(item.value))}</div><div class="row-actions"><button class="mini-btn" data-edit-position="${item.id}">Editar</button><button class="mini-btn danger" data-delete-position="${item.id}">Excluir</button></div></div></div>`).join('');
  $('#positionsList').innerHTML = autoRow + manualRows || '<div class="empty-state">Nenhuma posição.</div>';
  $('#positionsList').classList.toggle('empty-state', !(autoRow || manualRows));
}

function renderPlanning() {
  $('#monthlyContributionGoal').value = settings.monthlyContributionGoal ?? '';
  $('#realReturn').value = settings.realReturn ?? 5;
  $('#reserveTargetMonths').value = settings.reserveTargetMonths ?? 6;
  const positions = calcPositions();
  const selectedGoal = goalFor(selectedMonth);
  const monthly = safeNumber(settings.monthlyContributionGoal) || safeNumber(selectedGoal?.monthlySurplusGoal);
  const rate = safeNumber(settings.realReturn ?? 5);
  $('#projectionGrid').innerHTML = [5,10,20,30].map(years => `<div class="projection-item"><span>${years} anos</span><strong>${currency.format(projectFutureValue({ annualRealRate: rate, years, startingValue: positions.netWorth, monthlyContribution: monthly }))}</strong></div>`).join('');
  const reserve = reserveMetrics({ reserve: positions.reserve, transactions: txCache, recurring: recurringCache, todayYmd: ymd(new Date()), targetMonths: safeNumber(settings.reserveTargetMonths) || 6 });
  const items = [];
  if (positions.contributionAssets > 0) items.push(`Patrimônio formado por aportes: <b>${currency.format(positions.contributionAssets)}</b>, já incluído nos ativos totais.`);
  if (positions.debts > 0) items.push(`Dívidas cadastradas: <b>${currency.format(positions.debts)}</b>. O saldo devedor entra no patrimônio líquido; parcelas mensais entram apenas no fluxo de caixa.`);
  if (reserve.months != null) items.push(`Reserva atual cobre <b>${reserve.months.toFixed(1)} meses</b>, usando despesas recorrentes ativas de <b>${currency.format(reserve.monthlyBase)}</b> por mês.`);
  if (monthly > 0) items.push(`A projeção usa aporte mensal de <b>${currency.format(monthly)}</b> e retorno real de <b>${rate.toFixed(1)}% a.a.</b>. É um cenário matemático, não uma promessa de retorno.`);
  $('#diagnosis').innerHTML = (items.length ? items : ['Cadastre patrimônio, metas e lançamentos para liberar o diagnóstico.']).map(text => `<div class="diagnosis-item">${text}</div>`).join('');
}

function fillCategories(select, type, current) {
  select.innerHTML = categories[type].map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  if (current && categories[type].includes(current)) select.value = current;
}

function setTxType(type, currentCategory) {
  $('#transactionType').value = type;
  fillCategories($('#transactionCategory'), type, currentCategory);
  $$('[data-tx-type]').forEach(button => button.classList.toggle('selected', button.dataset.txType === type));
}

function openTransaction(tx = null) {
  if (tx && (tx.sourceType || isWithdrawal(tx))) return;
  $('#transactionForm').reset();
  $('#transactionEditId').value = tx?.id || '';
  const title = $('#transactionDialog h2');
  if (title) title.textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
  setTxType(tx?.type || 'expense', tx?.category);
  $('#transactionAmount').value = tx?.amount ?? '';
  $('#transactionDescription').value = tx?.description || '';
  $('#transactionDate').value = tx?.date || ymd(new Date());
  $('#transactionRecurring').checked = !!tx?.recurring;
  $('#transactionRecurring').disabled = !!tx;
  const recurringLabel = $('#transactionRecurring').closest('label');
  if (recurringLabel) recurringLabel.style.opacity = tx ? '.55' : '1';
  $('#transactionDialog').showModal();
}

function openPosition(position = null) {
  $('#positionForm').reset();
  $('#positionEditId').value = position?.id || '';
  $('#positionDialogTitle').textContent = position ? 'Editar posição' : 'Nova posição';
  $('#positionType').value = position?.type || 'asset';
  $('#positionName').value = position?.name || '';
  $('#positionValue').value = position?.value ?? '';
  $('#positionDialog').showModal();
}

function openRecurring(item = null) {
  $('#recurringForm').reset();
  $('#recurringEditId').value = item?.id || '';
  $('#recurringDialogTitle').textContent = item ? 'Editar conta recorrente' : 'Nova conta recorrente';
  $('#recurringType').value = item?.type || 'expense';
  fillCategories($('#recurringCategory'), $('#recurringType').value, item?.category);
  $('#recurringName').value = item?.name || '';
  $('#recurringAmount').value = item?.amount ?? '';
  $('#recurringDay').value = item?.dayOfMonth || new Date().getDate();
  $('#recurringStart').value = item?.startDate || ymd(new Date());
  $('#recurringEnd').value = item?.endDate || '';
  $('#recurringActive').checked = item ? !!item.active : true;
  $('#recurringDialog').showModal();
}

function openScheduled(item = null) {
  $('#scheduledForm').reset();
  $('#scheduledEditId').value = item?.id || '';
  $('#scheduledDialogTitle').textContent = item ? 'Editar conta agendada' : 'Nova conta agendada';
  $('#scheduledType').value = item?.type || 'expense';
  fillCategories($('#scheduledCategory'), $('#scheduledType').value, item?.category);
  $('#scheduledName').value = item?.name || '';
  $('#scheduledAmount').value = item?.amount ?? '';
  $('#scheduledDue').value = item?.dueDate || ymd(new Date());
  $('#scheduledFrequency').value = item?.frequency || 'once';
  $('#scheduledDialog').showModal();
}

function switchPage(page) {
  $$('.page').forEach(section => section.classList.toggle('active', section.id === `${page}Section`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  if (page === 'annual') renderAnnual();
  if (page === 'agenda') renderAgenda();
  if (page === 'planning') loadMonthlyGoalForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, () => signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value), 'Acesso liberado');
});
$('#resetPasswordBtn').addEventListener('click', async event => {
  const email = $('#email').value.trim();
  if (!email) return toast('Informe seu e-mail');
  await runAction(event.currentTarget, () => sendPasswordResetEmail(auth, email), 'E-mail de redefinição enviado');
});
$('#logoutBtn').addEventListener('click', () => signOut(auth));
$('#quickAddBtn').addEventListener('click', () => openTransaction());
$('#openTransactionBtn').addEventListener('click', () => openTransaction());
$('#openPositionBtn').addEventListener('click', () => openPosition());
$('#openRecurringBtn').addEventListener('click', () => openRecurring());
$('#openScheduledBtn').addEventListener('click', () => openScheduled());
$$('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('.nav-item').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.go)));
$('#prevMonth').addEventListener('click', () => { selectedMonth.setMonth(selectedMonth.getMonth() - 1); renderAll(); });
$('#nextMonth').addEventListener('click', () => { selectedMonth.setMonth(selectedMonth.getMonth() + 1); renderAll(); });
$('#prevYear').addEventListener('click', () => { selectedYear--; renderAnnual(); });
$('#nextYear').addEventListener('click', () => { selectedYear++; renderAnnual(); });
$('#txTypeFilter').addEventListener('change', renderTransactions);
$('#txSearch').addEventListener('input', renderTransactions);
$$('[data-tx-type]').forEach(button => button.addEventListener('click', () => setTxType(button.dataset.txType)));
$('#recurringType').addEventListener('change', () => fillCategories($('#recurringCategory'), $('#recurringType').value));
$('#scheduledType').addEventListener('change', () => fillCategories($('#scheduledCategory'), $('#scheduledType').value));

$('#transactionForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#transactionEditId').value;
    const amount = safeNumber($('#transactionAmount').value);
    const type = $('#transactionType').value;
    const category = $('#transactionCategory').value;
    const description = $('#transactionDescription').value.trim();
    const date = $('#transactionDate').value;
    if (!(amount > 0) || !['income','expense'].includes(type) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Lançamento inválido');
    if (id) {
      await updateDoc(userDoc('transactions', id), { type, amount, category, description, date });
    } else {
      const recurring = $('#transactionRecurring').checked;
      const ref = await addDoc(userCol('transactions'), { type, amount, category, description, date, recurring, createdAt: serverTimestamp() });
      if (recurring && agendaAvailable) {
        const day = Number(date.slice(8,10));
        await setDoc(userDoc('recurring', `legacy_${ref.id}`), {
          name: description || category,
          type, amount, category, description,
          dayOfMonth: day,
          startDate: date,
          endDate: '',
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }
    $('#transactionDialog').close();
    await loadAll();
  }, $('#transactionEditId').value ? 'Lançamento atualizado' : 'Lançamento salvo');
});

$('#positionForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#positionEditId').value;
    const type = $('#positionType').value;
    const name = $('#positionName').value.trim();
    const value = safeNumber($('#positionValue').value);
    if (!['asset','reserve','debt'].includes(type) || !name || value < 0) throw new Error('Posição inválida');
    if (id) await updateDoc(userDoc('positions', id), { type, name, value });
    else await addDoc(userCol('positions'), { type, name, value, createdAt: serverTimestamp() });
    $('#positionDialog').close();
    await loadAll();
  }, $('#positionEditId').value ? 'Posição atualizada' : 'Posição salva');
});

$('#planningForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const monthlyContributionGoal = safeNumber($('#monthlyContributionGoal').value);
    const realReturn = safeNumber($('#realReturn').value || 5);
    const reserveTargetMonths = safeNumber($('#reserveTargetMonths').value || 6);
    if (monthlyContributionGoal < 0 || realReturn < 0 || realReturn > 20 || reserveTargetMonths < 1 || reserveTargetMonths > 24) throw new Error('Planejamento inválido');
    settings = {
      monthlyContributionGoal,
      monthlySurplusGoal: 0,
      dailySpendGoal: 0,
      financialFreedomMonthlyCost: 0,
      realReturn,
      reserveTargetMonths,
      updatedAt: serverTimestamp()
    };
    await setDoc(userDoc('config','planning'), settings);
    await loadAll();
  }, 'Estratégia atualizada');
});

$('#recurringForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#recurringEditId').value;
    const name = $('#recurringName').value.trim();
    const type = $('#recurringType').value;
    const amount = safeNumber($('#recurringAmount').value);
    const category = $('#recurringCategory').value;
    const dayOfMonth = safeNumber($('#recurringDay').value);
    const startDate = $('#recurringStart').value;
    const endDate = $('#recurringEnd').value || '';
    const active = $('#recurringActive').checked;
    if (!name || !(amount > 0) || !['income','expense'].includes(type) || dayOfMonth < 1 || dayOfMonth > 31 || !startDate || (endDate && endDate < startDate)) throw new Error('Recorrência inválida');
    const data = { name, type, amount, category, description: name, dayOfMonth, startDate, endDate, active, updatedAt: serverTimestamp() };
    if (id) await updateDoc(userDoc('recurring', id), data);
    else await addDoc(userCol('recurring'), { ...data, createdAt: serverTimestamp() });
    $('#recurringDialog').close();
    await loadAll();
  }, 'Recorrência salva');
});

$('#scheduledForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#scheduledEditId').value;
    const name = $('#scheduledName').value.trim();
    const type = $('#scheduledType').value;
    const amount = safeNumber($('#scheduledAmount').value);
    const category = $('#scheduledCategory').value;
    const dueDate = $('#scheduledDue').value;
    const frequency = $('#scheduledFrequency').value;
    if (!name || !(amount > 0) || !['income','expense'].includes(type) || !dueDate || !['once','annual'].includes(frequency)) throw new Error('Agendamento inválido');
    const data = { name, type, amount, category, description: name, dueDate, frequency, status:'active', updatedAt: serverTimestamp() };
    if (id) await updateDoc(userDoc('scheduled', id), data);
    else await addDoc(userCol('scheduled'), { ...data, createdAt: serverTimestamp() });
    $('#scheduledDialog').close();
    await loadAll();
  }, 'Conta agendada salva');
});

document.addEventListener('click', async event => {
  const target = event.target;
  const withdraw = target.closest?.('[data-withdraw-contribution]');
  if (withdraw) { event.preventDefault(); openWithdrawal(); return; }
  if (target.dataset.editTx) return openTransaction(txCache.find(item => item.id === target.dataset.editTx));
  if (target.dataset.editPosition) return openPosition(positionsCache.find(item => item.id === target.dataset.editPosition));
  if (target.dataset.editRec) return openRecurring(recurringCache.find(item => item.id === target.dataset.editRec));
  if (target.dataset.editSch) return openScheduled(scheduledCache.find(item => item.id === target.dataset.editSch));
  if (target.dataset.deleteTx && confirm('Excluir este lançamento?')) await runAction(target, async () => { await deleteDoc(userDoc('transactions', target.dataset.deleteTx)); await loadAll(); }, 'Lançamento excluído');
  if (target.dataset.deletePosition && confirm('Excluir esta posição?')) await runAction(target, async () => { await deleteDoc(userDoc('positions', target.dataset.deletePosition)); await loadAll(); }, 'Posição excluída');
  if (target.dataset.delRec && confirm('Excluir esta recorrência? Os lançamentos já realizados permanecerão no histórico.')) await runAction(target, async () => { await deleteDoc(userDoc('recurring', target.dataset.delRec)); await loadAll(); }, 'Recorrência excluída');
  if (target.dataset.delSch && confirm('Excluir esta conta agendada? Os lançamentos já realizados permanecerão no histórico.')) await runAction(target, async () => { await deleteDoc(userDoc('scheduled', target.dataset.delSch)); await loadAll(); }, 'Agendamento excluído');
});

function xmlEsc(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sheetXml(name, headers, rows) {
  return `<Worksheet ss:Name="${xmlEsc(name)}"><Table><Row>${headers.map(h => `<Cell><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join('')}</Row>${rows.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEsc(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`;
}
function exportExcel() {
  const annual = [];
  for (let month = 0; month < 12; month++) {
    const date = new Date(selectedYear, month, 1), m = monthMetrics(txCache, date);
    annual.push([monthLabel(date), m.income, m.consumption, m.grossContribution, m.withdrawal, m.contribution, m.balance, m.contributionRate ?? 0]);
  }
  const positions = calcPositions();
  const positionRows = positionsCache.map(p => [p.type, p.name, safeNumber(p.value)]);
  positionRows.push(['asset','Patrimônio por aportes (automático)', positions.contributionAssets]);
  const sheets = [
    sheetXml('Resumo',['Indicador','Valor'],[
      ['Ativos totais', positions.assets],
      ['Patrimônio por aportes', positions.contributionAssets],
      ['Reserva', positions.reserve],
      ['Dívidas', positions.debts],
      ['Patrimônio líquido', positions.netWorth]
    ]),
    sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem'],txCache.map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual'])),
    sheetXml('Patrimônio',['Tipo','Nome','Valor'],positionRows),
    sheetXml('Recorrentes',['Nome','Tipo','Categoria','Valor','Dia','Início','Fim','Ativa'],recurringCache.map(r => [r.name,r.type,r.category,safeNumber(r.amount),r.dayOfMonth,r.startDate,r.endDate || '',r.active ? 'Sim' : 'Não'])),
    sheetXml('Agendadas',['Nome','Tipo','Categoria','Valor','Vencimento','Frequência','Status'],scheduledCache.map(s => [s.name,s.type,s.category,safeNumber(s.amount),s.dueDate,s.frequency,s.status])),
    sheetXml('Metas mensais',['Mês','Meta de aporte','Limite diário variável'],monthlyGoalsCache.map(g => [g.month || g.id,safeNumber(g.monthlySurplusGoal),safeNumber(g.dailySpendGoal)])),
    sheetXml(`Ano ${selectedYear}`,['Mês','Receitas','Gastos','Aportes brutos','Resgates','Aporte líquido','Saldo','Taxa de aporte (%)'],annual)
  ];
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join('')}</Workbook>`;
  const blob = new Blob([xml], { type:'application/vnd.ms-excel;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `meu-patrimonio-${ymd(new Date())}.xls`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Arquivo Excel gerado');
}
$('#exportExcelBtn').addEventListener('click', exportExcel);
$('#exportExcelAnnualBtn').addEventListener('click', exportExcel);

prepareUi();
onAuthStateChanged(auth, async current => {
  user = current;
  if (current) {
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    try { await loadAll(); }
    catch (error) { console.error(error); toast('Falha ao carregar os dados. Atualize a página.'); }
  } else {
    txCache = []; positionsCache = []; recurringCache = []; scheduledCache = []; monthlyGoalsCache = []; settings = {};
    $('#authView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker indisponível.', error));
}
