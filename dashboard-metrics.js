import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { monthMetrics, periodSpendingMetrics, positionMetrics, reserveMetrics, safeNumber, ymd } from "./finance-logic.js";

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2026, month, 1)).toLowerCase()
);

let latestTransactions = [];
let latestRecurring = [];
let latestPositions = [];
let latestPlanning = {};
let unsubs = [];
let renderTimer = null;
let observerInstalled = false;
let authObserverInstalled = false;

function selectedMonthFromUi() {
  const text = String(document.querySelector('#monthLabel')?.textContent || '').toLowerCase();
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const monthIndex = monthNames.findIndex(name => text.includes(name));
  if (yearMatch && monthIndex >= 0) return new Date(Number(yearMatch[1]), monthIndex, 1);
  const fallback = new Date();
  fallback.setDate(1);
  return fallback;
}

function setText(target, value) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element && element.textContent !== value) element.textContent = value;
}

function renderDashboardMetrics() {
  const selected = selectedMonthFromUi();
  const metrics = monthMetrics(latestTransactions, selected);
  const previousDate = new Date(selected);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previous = monthMetrics(latestTransactions, previousDate);

  setText('#monthBalance', currency.format(metrics.balance));
  setText('#balanceTrend', previous.totalOut === 0 && previous.income === 0
    ? 'Sem base anterior'
    : `${metrics.balance >= previous.balance ? '▲' : '▼'} ${currency.format(Math.abs(metrics.balance - previous.balance))} vs. mês anterior`);

  const spending = periodSpendingMetrics(latestTransactions, latestRecurring, selected);
  const spendingValue = document.querySelector('#debtValue');
  const spendingDetail = document.querySelector('#debtRatio');
  const spendingLabel = spendingValue?.closest('.mini-metric')?.querySelector('span');
  setText(spendingLabel, 'Gastos do período');
  setText(spendingValue, currency.format(spending.totalExpenses));
  setText(spendingDetail, `${currency.format(spending.recurringExpenses)} recorrentes + ${currency.format(spending.otherExpenses)} demais`);

  const today = ymd(new Date());
  const positions = positionMetrics(latestPositions, latestTransactions, today);
  const targetMonths = Math.max(1, safeNumber(latestPlanning.reserveTargetMonths) || 6);
  const reserve = reserveMetrics({
    reserve: positions.reserve,
    transactions: latestTransactions,
    recurring: latestRecurring,
    todayYmd: today,
    targetMonths
  });

  if (reserve.progress != null) {
    setText('#reserveMonths', `${reserve.months.toFixed(1)} / ${targetMonths} meses`);
    setText('#reserveValue', `${currency.format(positions.reserve)} de ${currency.format(reserve.target)}`);
    setText('#freedomPercent', `${Math.round(reserve.progress * 100)}%`);
    document.querySelector('#freedomRing')?.style.setProperty('--p', `${reserve.progress * 100}%`);
    setText('#freedomTarget', currency.format(reserve.target));
    setText('#freedomGap', currency.format(Math.max(0, reserve.target - positions.reserve)));
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

function scheduleRender(delay = 20) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    requestAnimationFrame(renderDashboardMetrics);
  }, delay);
}

function stopSubscriptions() {
  unsubs.forEach(unsub => { try { unsub(); } catch {} });
  unsubs = [];
}

function subscribe(uid) {
  stopSubscriptions();
  const db = getFirestore(getApp());
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'transactions'), snapshot => {
    latestTransactions = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Dashboard/lançamentos:', error)));
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'recurring'), snapshot => {
    latestRecurring = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Dashboard/recorrências:', error)));
  unsubs.push(onSnapshot(collection(db, 'users', uid, 'positions'), snapshot => {
    latestPositions = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, error => console.warn('Dashboard/posições:', error)));
  unsubs.push(onSnapshot(doc(db, 'users', uid, 'config', 'planning'), snapshot => {
    latestPlanning = snapshot.exists() ? snapshot.data() : {};
    scheduleRender();
  }, error => console.warn('Dashboard/planejamento:', error)));
}

function installObserver() {
  if (observerInstalled) return;
  observerInstalled = true;
  const targets = ['#monthLabel', '#monthBalance', '#reserveMonths', '#reserveValue', '#debtValue', '#debtRatio']
    .map(selector => document.querySelector(selector))
    .filter(Boolean);
  if (!targets.length) return;
  const observer = new MutationObserver(() => scheduleRender());
  targets.forEach(element => observer.observe(element, { childList: true, characterData: true, subtree: true }));
}

function startWhenReady() {
  if (!getApps().length) return false;
  installObserver();
  if (!authObserverInstalled) {
    authObserverInstalled = true;
    onAuthStateChanged(getAuth(getApp()), currentUser => {
      if (currentUser) subscribe(currentUser.uid);
      else {
        stopSubscriptions();
        latestTransactions = [];
        latestRecurring = [];
        latestPositions = [];
        latestPlanning = {};
      }
    });
  }
  return true;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
else installObserver();

if (!startWhenReady()) {
  const waitForFirebase = setInterval(() => {
    if (startWhenReady()) clearInterval(waitForFirebase);
  }, 50);
  setTimeout(() => clearInterval(waitForFirebase), 5000);
}
