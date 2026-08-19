import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { periodSpendingMetrics } from "./finance-logic.js";

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2026, month, 1)).toLowerCase()
);

let timer = null;
let requestId = 0;

function selectedMonthFromUi() {
  const text = String(document.querySelector('#monthLabel')?.textContent || '').toLowerCase();
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const monthIndex = monthNames.findIndex(name => text.includes(name));
  if (yearMatch && monthIndex >= 0) return new Date(Number(yearMatch[1]), monthIndex, 1);
  const fallback = new Date();
  fallback.setDate(1);
  return fallback;
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

async function syncSpendingCard() {
  const currentRequest = ++requestId;
  if (!getApps().length) return;
  const app = getApp();
  const auth = getAuth(app);
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const db = getFirestore(app);
  const userRoot = ['users', currentUser.uid];
  try {
    const [transactionsSnapshot, recurringSnapshot] = await Promise.all([
      getDocs(collection(db, ...userRoot, 'transactions')),
      getDocs(collection(db, ...userRoot, 'recurring'))
    ]);
    if (currentRequest !== requestId) return;

    const transactions = transactionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const recurring = recurringSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const metrics = periodSpendingMetrics(transactions, recurring, selectedMonthFromUi());

    const value = document.querySelector('#debtValue');
    const detail = document.querySelector('#debtRatio');
    const label = value?.closest('.mini-metric')?.querySelector('span');
    setText(label, 'Gastos do período');
    setText(value, currency.format(metrics.totalExpenses));
    setText(detail, `${currency.format(metrics.recurringExpenses)} recorrentes + ${currency.format(metrics.otherExpenses)} demais`);
  } catch (error) {
    console.warn('Não foi possível atualizar o resumo de gastos do período.', error);
  }
}

function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(syncSpendingCard, 80);
}

function installObservers() {
  ['#monthLabel', '#expenseTotal', '#recurringCount'].forEach(selector => {
    const element = document.querySelector(selector);
    if (!element) return;
    new MutationObserver(scheduleSync).observe(element, { childList: true, characterData: true, subtree: true });
  });
  scheduleSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObservers, { once: true });
else installObservers();

const waitForFirebase = setInterval(() => {
  if (!getApps().length) return;
  clearInterval(waitForFirebase);
  onAuthStateChanged(getAuth(getApp()), currentUser => {
    if (currentUser) scheduleSync();
  });
}, 50);
setTimeout(() => clearInterval(waitForFirebase), 5000);
