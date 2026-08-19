import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import {
  contributionBalance, isWithdrawal, monthKey, monthMetrics, periodSpendingMetrics,
  positionMetrics, projectFutureValue, reserveMetrics, safeNumber, WITHDRAWAL_CATEGORY, ymd
} from "./finance-logic.js";

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthNames = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

let currentUser = null;
let db = null;
let latestTx = [];
let latestPositions = [];
let latestRecurring = [];
let latestPlanning = {};
let latestMonthlyGoals = [];
let unsubs = [];
let withdrawalBusy = false;
let renderTimer = null;
let handlersInstalled = false;
let observersInstalled = false;
let authObserverInstalled = false;

function norm(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function selectedMonth() {
  const text = norm(document.querySelector('#monthLabel')?.textContent || '');
  const month = monthNames.findIndex(name => text.includes(name));
  const year = Number((text.match(/20\d{2}/) || [])[0]) || new Date().getFullYear();
  return new Date(year, month >= 0 ? month : new Date().getMonth(), 1);
}

function selectedYear() {
  const value = Number(document.querySelector('#yearLabel')?.textContent);
  return Number.isFinite(value) && value >= 2000 && value <= 2200 ? value : new Date().getFullYear();
}

function selectedMonthlyGoal(date = selectedMonth()) {
  const key = monthKey(date);
  return latestMonthlyGoals.find(item => item.id === key || item.month === key) || null;
}

function setText(target, value) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element && element.textContent !== value) element.textContent = value;
}

function setHtml(target, value) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element && element.innerHTML !== value) element.innerHTML = value;
}

function toast(message) {
  const element = document.querySelector('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

function currentPositionState() {
  return positionMetrics(latestPositions, latestTx, ymd(new Date()));
}

function ensureWithdrawalDialog() {
  if (document.querySelector('#withdrawalDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'withdrawalDialog';
  dialog.innerHTML = `<form id="withdrawalForm" method="dialog" class="sheet-form">
    <div class="dialog-head"><div><span class="card-kicker">MOVIMENTAÇÃO PATRIMONIAL</span><h2>Resgatar para o saldo do mês</h2></div><button type="button" class="icon-btn" id="closeWithdrawalDialog">×</button></div>
    <p class="muted" style="margin-top:0">O valor sai do patrimônio acumulado por aportes e entra no saldo em conta do mês. Não será contado como renda.</p>
    <label>Valor<input id="withdrawalAmount" type="number" min="0.01" step="0.01" required></label>
    <label>Data<input id="withdrawalDate" type="date" required></label>
    <label>Descrição<input id="withdrawalDescription" maxlength="80" value="Resgate para saldo em conta"></label>
    <div id="withdrawalAvailable" class="muted"></div>
    <button class="primary" type="submit">Confirmar resgate</button>
  </form>`;
  document.body.appendChild(dialog);
  document.querySelector('#closeWithdrawalDialog')?.addEventListener('click', () => dialog.close());
  document.querySelector('#withdrawalForm')?.addEventListener('submit', submitWithdrawal);
}

function openWithdrawal() {
  ensureWithdrawalDialog();
  const today = ymd(new Date());
  const available = contributionBalance(latestTx, today);
  if (!(available > 0)) return toast('Não há patrimônio de aportes disponível para resgate.');
  const amountInput = document.querySelector('#withdrawalAmount');
  const dateInput = document.querySelector('#withdrawalDate');
  if (amountInput) {
    amountInput.value = '';
    amountInput.max = String(available);
  }
  if (dateInput) dateInput.value = today;
  setText('#withdrawalAvailable', `Disponível até hoje: ${currency.format(available)}`);
  document.querySelector('#withdrawalDialog')?.showModal();
}

async function submitWithdrawal(event) {
  event.preventDefault();
  if (withdrawalBusy || !currentUser || !db) return;
  const button = event.submitter;
  const amount = safeNumber(document.querySelector('#withdrawalAmount')?.value);
  const date = String(document.querySelector('#withdrawalDate')?.value || '');
  const description = String(document.querySelector('#withdrawalDescription')?.value || '').trim() || 'Resgate para saldo em conta';
  const available = contributionBalance(latestTx, date);
  if (!(amount > 0)) return toast('Informe um valor válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Informe uma data válida.');
  if (amount > available) return toast(`O máximo disponível nessa data é ${currency.format(available)}.`);

  withdrawalBusy = true;
  if (button) button.disabled = true;
  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'transactions'), {
      type: 'income', amount, category: WITHDRAWAL_CATEGORY, description, date,
      recurring: false, createdAt: serverTimestamp()
    });
    document.querySelector('#withdrawalDialog')?.close();
    toast('Valor movimentado para o saldo do mês.');
  } catch (error) {
    console.error(error);
    toast('Não foi possível realizar o resgate.');
  } finally {
    withdrawalBusy = false;
    if (button) button.disabled = false;
  }
}

function ensureAutomaticPosition(contributionAssets) {
  const list = document.querySelector('#positionsList');
  if (!list) return;
  let row = list.querySelector('[data-auto-contribution-position]');
  if (!row) {
    row = document.createElement('div');
    row.className = 'list-row';
    row.dataset.autoContributionPosition = 'true';
    list.prepend(row);
  }
  const html = `<div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · aportes realizados menos resgates</small></div><div><div class="money income">${currency.format(contributionAssets)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution ${contributionAssets > 0 ? '' : 'disabled'}>Mover para saldo</button></div></div>`;
  if (row.innerHTML !== html) row.innerHTML = html;
  list.classList.remove('empty-state');
}

function renderPatrimony() {
  if (!currentUser) return;
  const state = currentPositionState();
  setText('#assetsTotal', currency.format(state.assets));
  setText('#debtsTotal', currency.format(state.debts));
  setText('#patrimonyNetWorth', currency.format(state.netWorth));
  setText('#netWorth', currency.format(state.netWorth));
  setText('#netWorthContext', `${currency.format(state.assets)} em ativos − ${currency.format(state.debts)} em dívidas`);
  ensureAutomaticPosition(state.contributionAssets);
}

function renderDashboardMetrics() {
  if (!currentUser) return;
  const selected = selectedMonth();
  const metrics = monthMetrics(latestTx, selected);
  const previousDate = new Date(selected);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previous = monthMetrics(latestTx, previousDate);

  setText('#monthBalance', currency.format(metrics.balance));
  setText('#balanceTrend', previous.totalOut === 0 && previous.income === 0
    ? 'Sem base anterior'
    : `${metrics.balance >= previous.balance ? '▲' : '▼'} ${currency.format(Math.abs(metrics.balance - previous.balance))} vs. mês anterior`);

  const spending = periodSpendingMetrics(latestTx, latestRecurring, selected);
  const spendingValue = document.querySelector('#debtValue');
  const spendingLabel = spendingValue?.closest('.mini-metric')?.querySelector('span');
  setText(spendingLabel, 'Gastos do período');
  setText(spendingValue, currency.format(spending.totalExpenses));
  setText('#debtRatio', `${currency.format(spending.recurringExpenses)} recorrentes + ${currency.format(spending.otherExpenses)} demais`);

  const today = ymd(new Date());
  const state = positionMetrics(latestPositions, latestTx, today);
  const targetMonths = Math.max(1, safeNumber(latestPlanning.reserveTargetMonths) || 6);
  const reserve = reserveMetrics({
    reserve: state.reserve,
    transactions: latestTx,
    recurring: latestRecurring,
    todayYmd: today,
    targetMonths
  });

  if (reserve.progress != null) {
    setText('#reserveMonths', `${reserve.months.toFixed(1)} / ${targetMonths} meses`);
    setText('#reserveValue', `${currency.format(state.reserve)} de ${currency.format(reserve.target)}`);
    setText('#freedomPercent', `${Math.round(reserve.progress * 100)}%`);
    document.querySelector('#freedomRing')?.style.setProperty('--p', `${reserve.progress * 100}%`);
    setText('#freedomTarget', currency.format(reserve.target));
    setText('#freedomGap', currency.format(Math.max(0, reserve.target - state.reserve)));
    setText('#freedomBadge', `Reserva ${reserve.months.toFixed(1)} meses`);
  } else {
    setText('#reserveMonths', '—');
    setText('#reserveValue', 'Cadastre despesas recorrentes');
    setText('#freedomPercent', '—');
    document.querySelector('#freedomRing')?.style.setProperty('--p', '0%');
    setText('#freedomTarget', '—');
    setText('#freedomGap', '—');
    setText('#freedomBadge', 'Reserva não calculável');
  }
}

function renderContributionLabels() {
  const savingLabel = document.querySelector('#savingRate')?.closest('.mini-metric')?.querySelector('span');
  setText(savingLabel, 'Taxa de aporte líquido');
  const firstGoal = document.querySelector('.goal-card .goal-grid > div > span');
  setText(firstGoal, 'Aporte líquido');
  const metrics = monthMetrics(latestTx, selectedMonth());
  if (metrics.withdrawal > 0) {
    setText('#savingStatus', `Aporte líquido ${currency.format(metrics.contribution)} · aportes ${currency.format(metrics.grossContribution)} · resgates ${currency.format(metrics.withdrawal)}`);
  }
}

function renderProjection() {
  if (!currentUser) return;
  const projection = document.querySelector('#projectionGrid');
  if (!projection) return;
  const state = currentPositionState();
  const goal = selectedMonthlyGoal();
  const monthly = safeNumber(latestPlanning.monthlyContributionGoal) || safeNumber(goal?.monthlySurplusGoal);
  const rate = safeNumber(latestPlanning.realReturn ?? 5);
  const html = [5, 10, 20, 30].map(years =>
    `<div class="projection-item"><span>${years} anos</span><strong>${currency.format(projectFutureValue({ annualRealRate: rate, years, startingValue: state.netWorth, monthlyContribution: monthly }))}</strong></div>`
  ).join('');
  setHtml(projection, html);
}

function protectWithdrawalEdits() {
  latestTx.filter(isWithdrawal).forEach(tx => {
    document.querySelectorAll(`[data-edit-tx="${CSS.escape(tx.id)}"]`).forEach(button => button.remove());
  });
}

function renderAllSynced() {
  renderPatrimony();
  renderDashboardMetrics();
  renderContributionLabels();
  renderProjection();
  protectWithdrawalEdits();
}

function scheduleRender(delay = 20) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => requestAnimationFrame(renderAllSynced), delay);
}

function stopSubscriptions() {
  unsubs.forEach(unsub => { try { unsub(); } catch {} });
  unsubs = [];
}

function subscribe(uid) {
  stopSubscriptions();
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'transactions'), snapshot => {
    latestTx = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Sincronização/lançamentos:', error)));
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'positions'), snapshot => {
    latestPositions = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Sincronização/posições:', error)));
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'recurring'), snapshot => {
    latestRecurring = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Sincronização/recorrências:', error)));
  unsubs.push(onSnapshot(doc(db, 'users', uid, 'config', 'planning'), snapshot => {
    latestPlanning = snapshot.exists() ? snapshot.data() : {};
    scheduleRender();
  }, error => console.warn('Sincronização/planejamento:', error)));
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'monthlyGoals'), snapshot => {
    latestMonthlyGoals = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Sincronização/metas:', error)));
}

function installObservers() {
  if (observersInstalled) return;
  observersInstalled = true;
  const selectors = [
    '#monthLabel', '#monthBalance', '#reserveMonths', '#reserveValue', '#debtValue', '#debtRatio',
    '#netWorth', '#assetsTotal', '#debtsTotal', '#patrimonyNetWorth', '#positionsList', '#projectionGrid', '#savingStatus'
  ];
  const targets = selectors.map(selector => document.querySelector(selector)).filter(Boolean);
  const observer = new MutationObserver(() => scheduleRender());
  targets.forEach(element => observer.observe(element, { childList: true, characterData: true, subtree: true }));
}

function xmlEsc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheetXml(name, headers, rows) {
  return `<Worksheet ss:Name="${xmlEsc(name)}"><Table><Row>${headers.map(header => `<Cell><Data ss:Type="String">${xmlEsc(header)}</Data></Cell>`).join('')}</Row>${rows.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEsc(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`;
}

async function loadForExport(name, sortField = '') {
  if (!currentUser || !db) return [];
  const snapshot = await getDocs(collection(db, 'users', currentUser.uid, name));
  const rows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  if (sortField) rows.sort((a, b) => String(a?.[sortField] || '').localeCompare(String(b?.[sortField] || '')));
  return rows;
}

async function exportExcel() {
  if (!currentUser) return toast('Entre na sua conta para exportar.');
  try {
    const [recurring, scheduled] = await Promise.all([
      loadForExport('recurring', 'startDate'),
      loadForExport('scheduled', 'dueDate')
    ]);
    const state = currentPositionState();
    const year = selectedYear();
    const annual = [];
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(year, month, 1);
      const metrics = monthMetrics(latestTx, date);
      annual.push([
        date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        metrics.income, metrics.consumption, metrics.grossContribution, metrics.withdrawal,
        metrics.contribution, metrics.balance, metrics.contributionRate ?? 0
      ]);
    }

    const positionRows = latestPositions.map(item => [item.type, item.name, safeNumber(item.value)]);
    positionRows.push(['asset', 'Patrimônio por aportes (automático)', state.contributionAssets]);
    const summaryRows = [
      ['Data-base', ymd(new Date())],
      ['Ativos manuais', state.manualAssets],
      ['Patrimônio por aportes', state.contributionAssets],
      ['Ativos totais', state.assets],
      ['Reserva de emergência', state.reserve],
      ['Dívidas', state.debts],
      ['Patrimônio líquido', state.netWorth]
    ];

    const sheets = [
      sheetXml('Resumo', ['Indicador', 'Valor'], summaryRows),
      sheetXml('Lançamentos', ['Data','Tipo','Categoria','Descrição','Valor','Origem'], latestTx.map(tx => [tx.date, tx.type, tx.category, tx.description || '', safeNumber(tx.amount), tx.sourceType || 'manual'])),
      sheetXml('Patrimônio', ['Tipo','Nome','Valor'], positionRows),
      sheetXml('Recorrentes', ['Nome','Tipo','Categoria','Valor','Dia','Início','Fim','Ativa'], recurring.map(item => [item.name, item.type, item.category, safeNumber(item.amount), safeNumber(item.dayOfMonth), item.startDate, item.endDate || '', item.active ? 'Sim' : 'Não'])),
      sheetXml('Agendadas', ['Nome','Tipo','Categoria','Valor','Vencimento','Frequência','Status'], scheduled.map(item => [item.name, item.type, item.category, safeNumber(item.amount), item.dueDate, item.frequency, item.status])),
      sheetXml('Metas mensais', ['Mês','Meta de aporte','Limite diário variável'], latestMonthlyGoals.map(item => [item.month || item.id, safeNumber(item.monthlySurplusGoal), safeNumber(item.dailySpendGoal)])),
      sheetXml(`Ano ${year}`, ['Mês','Receitas','Gastos de consumo','Aportes brutos','Resgates','Aporte líquido','Saldo','Taxa de aporte (%)'], annual)
    ];
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join('')}</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `meu-patrimonio-${ymd(new Date())}.xls`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('Arquivo Excel gerado com patrimônio consolidado.');
  } catch (error) {
    console.error(error);
    toast('Não foi possível gerar o Excel.');
  }
}

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  ensureWithdrawalDialog();

  document.addEventListener('click', event => {
    const exportButton = event.target.closest('#exportExcelBtn, #exportExcelAnnualBtn');
    if (exportButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      exportExcel();
      return;
    }

    const withdraw = event.target.closest('[data-withdraw-contribution]');
    if (withdraw) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openWithdrawal();
      return;
    }

    const edit = event.target.closest('[data-edit-tx]');
    if (edit && latestTx.some(tx => tx.id === edit.dataset.editTx && isWithdrawal(tx))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Para alterar um resgate, exclua-o e faça uma nova movimentação.');
      return;
    }

    if (event.target.closest('[data-delete-tx],[data-edit-position],[data-delete-position],.nav-item,[data-go],#prevMonth,#nextMonth,#prevYear,#nextYear')) {
      scheduleRender(30);
    }
  }, true);

  document.addEventListener('submit', () => scheduleRender(80), true);
}

function startWhenReady() {
  if (!getApps().length) return false;
  db = getFirestore(getApp());
  installHandlers();
  installObservers();
  if (!authObserverInstalled) {
    authObserverInstalled = true;
    onAuthStateChanged(getAuth(getApp()), authUser => {
      currentUser = authUser;
      latestTx = [];
      latestPositions = [];
      latestRecurring = [];
      latestPlanning = {};
      latestMonthlyGoals = [];
      if (authUser) subscribe(authUser.uid);
      else stopSubscriptions();
    });
  }
  return true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    installHandlers();
    installObservers();
    startWhenReady();
  }, { once: true });
} else {
  installHandlers();
  installObservers();
}

if (!startWhenReady()) {
  const waitForFirebase = setInterval(() => {
    if (startWhenReady()) clearInterval(waitForFirebase);
  }, 50);
  setTimeout(() => clearInterval(waitForFirebase), 5000);
}
