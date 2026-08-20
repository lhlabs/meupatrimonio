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
  CONTRIBUTION_CATEGORY, WITHDRAWAL_CATEGORY, addYear, cardDebtMetrics, cardInstallmentSchedule, clamp, contributionBalance,
  isArchivedTransaction, isContribution, isWithdrawal, monthKey, monthMetrics, monthlySpendingGoal,
  nextRecurringDue, periodSpendingMetrics, positionMetrics, projectFutureValue,
  recurringDue, reserveMetrics, safeNumber, scoreMetrics, shouldMaterializeRecurring, walletMetrics, ymd
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
let walletsCache = [];
let cardsCache = [];
let monthlyGoalsCache = [];
let settings = {};
let agendaAvailable = true;
let annualForecast = false;
let actionBusy = false;
let observedToday = ymd(new Date());
let rolloverSyncBusy = false;

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
function calcPositions() { return positionMetrics(positionsCache, txCache, ymd(new Date()), walletsCache, cardsCache, scheduledCache); }
function walletById(id) { return walletsCache.find(item => item.id === id) || null; }
function cardById(id) { return cardsCache.find(item => item.id === id) || null; }
function newEntityId(prefix = 'id') { return `${prefix}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g, '_'); }
function installmentPlansForMonth(date) { return plannedForMonth(date).filter(item => item.installmentGroupId); }
function transactionsWithInstallmentPlans(date) { return [...txCache, ...installmentPlansForMonth(date)]; }
function metricsForMonth(date) { return monthMetrics(transactionsWithInstallmentPlans(date), date, recurringCache); }
function spendingForMonth(date) { return periodSpendingMetrics(transactionsWithInstallmentPlans(date), recurringCache, date); }
function timestampValue(value) { return value?.toMillis?.() ?? 0; }
function dateFromMonthKey(key) {
  const [year, month] = String(key || '').split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month - 1, 1) : null;
}
function scheduledTransactionId(scheduled, due) {
  if (!scheduled?.id || !due) return '';
  return scheduled.frequency === 'annual'
    ? `sched_${scheduled.id}_${String(due).slice(0,4)}`
    : `sched_${scheduled.id}`;
}
function latestScheduledTransaction(sourceId) {
  return txCache
    .filter(tx => tx.sourceType === 'scheduled' && tx.sourceId === sourceId)
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || timestampValue(b.createdAt) - timestampValue(a.createdAt))[0] || null;
}

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
  const patrimonyKicker = $('#netWorth')?.closest('.networth-card')?.querySelector('.card-kicker');
  if (patrimonyKicker) patrimonyKicker.textContent = 'PATRIMÔNIO';
  const patrimonyLabels = $$('#patrimonySection .metric-strip .mini-metric > span');
  if (patrimonyLabels[0]) patrimonyLabels[0].textContent = 'Ativos';
  if (patrimonyLabels[1]) patrimonyLabels[1].textContent = 'Dívidas (informativo)';
  if (patrimonyLabels[2]) patrimonyLabels[2].textContent = 'Patrimônio';

  const goalCard = $('.goal-card');
  if (goalCard) {
    const h = goalCard.querySelector('h2');
    if (h) h.textContent = 'Metas financeiras do mês';
    const labels = goalCard.querySelectorAll('.goal-grid > div > span');
    if (labels[0]) labels[0].textContent = 'Aporte líquido';
    if (labels[1]) labels[1].textContent = 'Gasto mensal (60% da renda)';
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

  installTransactionPeriodFilter();
  installMonthlyGoalForm();
  installAnnualToggle();
  ensureWithdrawalDialog();
  installAccountUi();
  installTransactionRoutingUi();
  installDebtFieldsUi();
}


function walletTypeLabel(type) {
  return ({ checking:'Conta corrente', savings:'Poupança', cash:'Dinheiro', digital:'Conta digital', other:'Outra' })[type] || 'Carteira';
}

function debtKindLabel(type) {
  return ({ vehicle_financing:'Financiamento veicular', mortgage:'Financiamento habitacional', installment:'Compra parcelada', personal_loan:'Empréstimo pessoal', student_loan:'Financiamento estudantil', other:'Outra dívida' })[type] || 'Dívida';
}

function accountOptions(rows, selected = '', emptyLabel = 'Selecione') {
  const active = rows.filter(item => item.active !== false || item.id === selected);
  return `<option value="">${emptyLabel}</option>${active.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.institution)} · ${esc(item.name)}</option>`).join('')}`;
}

function refreshAccountSelects() {
  const walletIds = ['transactionWalletId','recurringWalletId','scheduledWalletId','withdrawalWalletId','cardPaymentWalletId'];
  walletIds.forEach(id => {
    const select = $('#'+id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = accountOptions(walletsCache, current, walletsCache.some(item => item.active !== false) ? 'Selecione a carteira' : 'Cadastre uma carteira primeiro');
    if (walletsCache.some(item => item.id === current)) select.value = current;
  });
  const cardSelect = $('#transactionCardId');
  if (cardSelect) {
    const current = cardSelect.value;
    cardSelect.innerHTML = accountOptions(cardsCache, current, cardsCache.some(item => item.active !== false) ? 'Selecione o cartão' : 'Cadastre um cartão primeiro');
    if (cardsCache.some(item => item.id === current)) cardSelect.value = current;
  }
  syncTransactionRouting();
}

function installAccountUi() {
  if ($('#accountHub')) return;
  const section = $('#patrimonySection');
  const anchor = section?.querySelector('.metric-strip');
  if (!section || !anchor) return;
  const heroTitle = section.querySelector('.section-hero h2');
  const heroText = section.querySelector('.section-hero p');
  const navLabel = $('[data-page="patrimony"] small');
  if (heroTitle) heroTitle.textContent = 'Carteiras & patrimônio';
  if (heroText) heroText.textContent = 'Contas, cartões, ativos, reserva e obrigações em uma visão única.';
  if (navLabel) navLabel.textContent = 'Carteiras';

  const panel = document.createElement('article');
  panel.id = 'accountHub';
  panel.className = 'panel account-hub';
  panel.innerHTML = `
    <div class="panel-head account-head"><div><span class="card-kicker">CARTEIRAS</span><h2>Onde seu dinheiro está</h2><p class="muted">O saldo é calculado pelo saldo inicial + movimentações. Cartões baixam a carteira pagadora somente no vencimento.</p></div><div class="button-row"><button id="openWalletBtn" class="ghost-btn" type="button">+ Carteira</button><button id="openCardBtn" class="primary compact" type="button">+ Cartão</button></div></div>
    <div class="account-summary"><div><span>Saldo em carteiras</span><strong id="walletsTotal">R$ 0</strong></div><div><span>Cartões em aberto</span><strong id="cardsOpenTotal">R$ 0</strong></div><div><span>Limite disponível</span><strong id="accountsLiquid">R$ 0</strong></div></div>
    <div class="account-section-title"><strong>Instituições e contas</strong><small id="walletCount" class="muted"></small></div><div id="walletCards" class="account-grid"></div>
    <div class="account-section-title"><strong>Cartões de crédito</strong><small id="cardCount" class="muted"></small></div><div id="creditCardCards" class="account-grid"></div>
    <div class="account-section-title"><strong>Compras parceladas</strong><small class="muted">parcelas futuras</small></div><div id="installmentGroups" class="installment-list"></div>`;
  anchor.parentNode.insertBefore(panel, anchor);

  const walletDialog = document.createElement('dialog');
  walletDialog.id = 'walletDialog';
  walletDialog.innerHTML = `<form id="walletForm" method="dialog" class="sheet-form"><input id="walletEditId" type="hidden"><div class="dialog-head"><div><span class="card-kicker">CARTEIRA</span><h2 id="walletDialogTitle">Nova carteira</h2></div><button type="button" class="icon-btn" data-close-account-dialog>×</button></div><label>Instituição<input id="walletInstitution" maxlength="60" required placeholder="Ex.: Nubank, Sicredi, Caixa"></label><label>Nome da conta<input id="walletName" maxlength="60" required placeholder="Ex.: Conta principal"></label><label>Tipo<select id="walletType"><option value="checking">Conta corrente</option><option value="digital">Conta digital</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="other">Outra</option></select></label><label>Saldo inicial no app<input id="walletInitialBalance" type="number" step="0.01" required value="0"></label><p class="muted account-help">Use o saldo existente no momento em que começar a movimentar esta carteira no Meu Patrimônio. O saldo atual não é armazenado: ele é recalculado pelas movimentações.</p><button class="primary" type="submit">Salvar carteira</button></form>`;
  document.body.appendChild(walletDialog);

  const cardDialog = document.createElement('dialog');
  cardDialog.id = 'cardDialog';
  cardDialog.innerHTML = `<form id="cardForm" method="dialog" class="sheet-form"><input id="cardEditId" type="hidden"><div class="dialog-head"><div><span class="card-kicker">CARTÃO</span><h2 id="cardDialogTitle">Novo cartão</h2></div><button type="button" class="icon-btn" data-close-account-dialog>×</button></div><label>Instituição<input id="cardInstitution" maxlength="60" required placeholder="Ex.: Nubank"></label><label>Nome do cartão<input id="cardName" maxlength="60" required placeholder="Ex.: Mastercard Black"></label><label>Limite<input id="cardLimit" type="number" min="0" step="0.01" required></label><div class="form-grid two"><label>Fechamento<input id="cardClosingDay" type="number" min="1" max="31" required></label><label>Vencimento<input id="cardDueDay" type="number" min="1" max="31" required></label></div><label>Carteira que paga a fatura<select id="cardPaymentWalletId" required></select></label><p class="muted account-help">O cartão não cria um segundo saldo. Cada parcela reduz esta carteira no vencimento e permanece como dívida de cartão até lá.</p><button class="primary" type="submit">Salvar cartão</button></form>`;
  document.body.appendChild(cardDialog);

  $('#openWalletBtn').addEventListener('click', () => openWallet());
  $('#openCardBtn').addEventListener('click', () => openCard());
  $('#walletForm').addEventListener('submit', submitWallet);
  $('#cardForm').addEventListener('submit', submitCard);
  $$('[data-close-account-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
}

function openWallet(wallet = null) {
  $('#walletForm').reset();
  $('#walletEditId').value = wallet?.id || '';
  $('#walletDialogTitle').textContent = wallet ? 'Editar carteira' : 'Nova carteira';
  $('#walletInstitution').value = wallet?.institution || '';
  $('#walletName').value = wallet?.name || '';
  $('#walletType').value = wallet?.type || 'checking';
  $('#walletInitialBalance').value = wallet?.initialBalance ?? 0;
  $('#walletDialog').showModal();
}

async function submitWallet(event) {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#walletEditId').value;
    const institution = $('#walletInstitution').value.trim();
    const name = $('#walletName').value.trim();
    const type = $('#walletType').value;
    const initialBalance = safeNumber($('#walletInitialBalance').value);
    if (!institution || !name || !['checking','savings','cash','digital','other'].includes(type) || Math.abs(initialBalance) >= 1000000000) throw new Error('Carteira inválida');
    const data = { institution, name, type, initialBalance, active:true, updatedAt:serverTimestamp() };
    if (id) await updateDoc(userDoc('wallets', id), data);
    else await addDoc(userCol('wallets'), { ...data, createdAt:serverTimestamp() });
    $('#walletDialog').close();
    await loadAll();
  }, 'Carteira salva');
}

function openCard(card = null) {
  if (!walletsCache.some(item => item.active !== false)) return toast('Cadastre uma carteira antes do cartão.');
  $('#cardForm').reset();
  $('#cardEditId').value = card?.id || '';
  $('#cardDialogTitle').textContent = card ? 'Editar cartão' : 'Novo cartão';
  $('#cardInstitution').value = card?.institution || '';
  $('#cardName').value = card?.name || '';
  $('#cardLimit').value = card?.creditLimit ?? '';
  $('#cardClosingDay').value = card?.closingDay ?? 5;
  $('#cardDueDay').value = card?.dueDay ?? 12;
  $('#cardPaymentWalletId').innerHTML = accountOptions(walletsCache, card?.paymentWalletId || '', 'Selecione a carteira');
  $('#cardPaymentWalletId').value = card?.paymentWalletId || walletsCache.find(item => item.active !== false)?.id || '';
  $('#cardDialog').showModal();
}

async function submitCard(event) {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#cardEditId').value;
    const institution = $('#cardInstitution').value.trim();
    const name = $('#cardName').value.trim();
    const creditLimit = safeNumber($('#cardLimit').value);
    const closingDay = Math.trunc(safeNumber($('#cardClosingDay').value));
    const dueDay = Math.trunc(safeNumber($('#cardDueDay').value));
    const paymentWalletId = $('#cardPaymentWalletId').value;
    if (!institution || !name || creditLimit < 0 || closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31 || !walletById(paymentWalletId)) throw new Error('Cartão inválido');
    const previous = id ? cardById(id) : null;
    const data = { institution, name, creditLimit, closingDay, dueDay, paymentWalletId, active:true, updatedAt:serverTimestamp() };
    if (id) await updateDoc(userDoc('cards', id), data);
    else await addDoc(userCol('cards'), { ...data, createdAt:serverTimestamp() });
    if (id && previous?.paymentWalletId && previous.paymentWalletId !== paymentWalletId) {
      for (const scheduled of scheduledCache.filter(item => item.status === 'active' && item.cardId === id)) {
        await updateDoc(userDoc('scheduled', scheduled.id), { walletId:paymentWalletId, updatedAt:serverTimestamp() });
      }
    }
    $('#cardDialog').close();
    await loadAll();
  }, 'Cartão salvo');
}

function renderAccounts() {
  if (!$('#accountHub')) return;
  const today = ymd(new Date());
  const wallets = walletMetrics(walletsCache, cardsCache, txCache, today);
  const cards = cardDebtMetrics(cardsCache, txCache, scheduledCache, today);
  $('#walletsTotal').textContent = currency.format(wallets.total);
  $('#cardsOpenTotal').textContent = currency.format(cards.total);
  $('#accountsLiquid').textContent = currency.format(cards.byCard.reduce((sum, item) => sum + safeNumber(item.availableLimit), 0));
  $('#walletCount').textContent = `${walletsCache.filter(item => item.active !== false).length} ativas`;
  $('#cardCount').textContent = `${cardsCache.filter(item => item.active !== false).length} ativos`;
  $('#walletCards').innerHTML = wallets.byWallet.map(item => `<div class="account-card ${item.active === false ? 'inactive' : ''}"><div class="account-card-top"><div class="account-logo">🏦</div><div><strong>${esc(item.name)}</strong><small>${esc(item.institution)} · ${walletTypeLabel(item.type)}</small></div></div><div class="account-balance"><span>Saldo atual</span><strong class="${item.balance < 0 ? 'expense' : ''}">${currency.format(item.balance)}</strong></div><div class="row-actions"><button class="mini-btn" data-edit-wallet="${item.id}">Editar</button><button class="mini-btn" data-toggle-wallet="${item.id}">${item.active === false ? 'Reativar' : 'Arquivar'}</button></div></div>`).join('') || '<div class="empty-state">Cadastre sua primeira instituição e conta.</div>';
  $('#creditCardCards').innerHTML = cards.byCard.map(item => `<div class="account-card card-account ${item.active === false ? 'inactive' : ''}"><div class="account-card-top"><div class="account-logo">💳</div><div><strong>${esc(item.name)}</strong><small>${esc(item.institution)} · fecha dia ${item.closingDay} · vence dia ${item.dueDay}</small></div></div><div class="card-stats"><div><span>Em aberto</span><strong>${currency.format(item.open)}</strong></div><div><span>Próxima fatura</span><strong>${currency.format(item.nextInvoice)}</strong></div><div><span>Limite disponível</span><strong>${currency.format(item.availableLimit)}</strong></div></div><small class="muted">Pagamento: ${esc(walletById(item.paymentWalletId)?.name || 'Carteira não localizada')}${item.nextDue ? ` · próximo vencimento ${formatDate(item.nextDue)}` : ''}</small><div class="row-actions"><button class="mini-btn" data-edit-card="${item.id}">Editar</button><button class="mini-btn" data-toggle-card="${item.id}">${item.active === false ? 'Reativar' : 'Arquivar'}</button></div></div>`).join('') || '<div class="empty-state">Nenhum cartão cadastrado.</div>';

  const groups = new Map();
  scheduledCache.filter(item => item.installmentGroupId).forEach(item => {
    const key = item.installmentGroupId;
    if (!groups.has(key)) groups.set(key, { id:key, description:item.description || item.name, cardId:item.cardId, total:item.installmentTotal || 1, active:[], posted:[] });
    if (item.status === 'active') groups.get(key).active.push(item);
  });
  txCache.filter(item => item.installmentGroupId).forEach(item => {
    const key = item.installmentGroupId;
    if (!groups.has(key)) groups.set(key, { id:key, description:item.description || item.category, cardId:item.cardId, total:item.installmentTotal || 1, active:[], posted:[] });
    groups.get(key).posted.push(item);
  });
  const groupRows = [...groups.values()].filter(group => group.active.length).sort((a,b) => String(a.active[0]?.dueDate || '').localeCompare(String(b.active[0]?.dueDate || '')));
  $('#installmentGroups').innerHTML = groupRows.map(group => {
    const active = group.active.sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const remaining = active.reduce((sum,item) => sum + safeNumber(item.amount),0);
    const paid = new Set(group.posted.map(item => item.installmentNumber).filter(Boolean)).size;
    const card = cardById(group.cardId);
    const firstInvoice = active[0]?.dueDate ? monthLabel(dateFromMonthKey(String(active[0].dueDate).slice(0,7))) : '—';
    return `<div class="installment-row"><div><strong>${esc(group.description || 'Compra parcelada')}</strong><small>${esc(card?.name || 'Cartão')} · ${paid}/${group.total} pagas · 1ª fatura futura ${esc(firstInvoice)} · próxima ${formatDate(active[0]?.dueDate)}</small></div><div><strong>${currency.format(remaining)}</strong><small>saldo parcelado</small></div><div class="row-actions"><button class="mini-btn" data-edit-installment-group="${esc(group.id)}">Editar</button><button class="mini-btn danger" data-delete-installment-group="${esc(group.id)}">Excluir futuras</button></div></div>`;
  }).join('') || '<div class="empty-state">Nenhuma compra parcelada em aberto.</div>';
  refreshAccountSelects();
}

function installTransactionRoutingUi() {
  if ($('#transactionRouting')) return;
  const form = $('#transactionForm');
  const recurringLabel = $('#transactionRecurring')?.closest('label');
  if (!form || !recurringLabel) return;
  const box = document.createElement('div');
  box.id = 'transactionRouting';
  box.className = 'routing-box';
  box.innerHTML = `<label>Movimentar em<select id="transactionRoute"><option value="wallet">Carteira / conta</option><option value="card">Cartão de crédito</option><option value="none">Sem carteira (legado)</option></select></label><label id="transactionWalletLabel">Carteira<select id="transactionWalletId"></select></label><label id="transactionCardLabel" class="hidden">Cartão<select id="transactionCardId"></select></label><label id="transactionInstallmentsLabel" class="hidden">Parcelas<select id="transactionInstallments">${Array.from({length:60},(_,i)=>`<option value="${i+1}">${i+1}x</option>`).join('')}</select></label><label id="transactionFirstInvoiceLabel" class="hidden">Mês da primeira fatura<input id="transactionFirstInvoiceMonth" type="month"></label><small id="transactionRouteHint" class="muted routing-hint"></small>`;
  form.insertBefore(box, recurringLabel);
  $('#transactionRoute').addEventListener('change', () => { syncTransactionRouting(); syncFirstInvoiceMonth(); });
  $('#transactionCardId').addEventListener('change', () => syncFirstInvoiceMonth(true));
  $('#transactionDate').addEventListener('change', () => syncFirstInvoiceMonth(true));
  $('#transactionFirstInvoiceMonth').addEventListener('change', event => { event.target.dataset.manual = 'true'; });

  const recurringForm = $('#recurringForm');
  const recurringButton = recurringForm?.querySelector('button[type="submit"]');
  if (recurringButton) {
    const label = document.createElement('label'); label.innerHTML = 'Carteira<select id="recurringWalletId"></select>';
    recurringForm.insertBefore(label, recurringButton);
  }
  const scheduledForm = $('#scheduledForm');
  const scheduledButton = scheduledForm?.querySelector('button[type="submit"]');
  if (scheduledButton) {
    const label = document.createElement('label'); label.innerHTML = 'Carteira<select id="scheduledWalletId"></select>';
    scheduledForm.insertBefore(label, scheduledButton);
  }
  const withdrawalButton = $('#withdrawalForm button[type="submit"]');
  if (withdrawalButton && !$('#withdrawalWalletId')) {
    const label = document.createElement('label'); label.innerHTML = 'Carteira de destino<select id="withdrawalWalletId"></select>';
    withdrawalButton.parentNode.insertBefore(label, withdrawalButton);
  }
  refreshAccountSelects();
}

function syncFirstInvoiceMonth(force = false) {
  const input = $('#transactionFirstInvoiceMonth');
  if (!input || $('#transactionRoute')?.value !== 'card' || $('#transactionType')?.value !== 'expense') return;
  if (!force && input.dataset.manual === 'true' && input.value) return;
  const card = cardById($('#transactionCardId')?.value);
  const purchaseDate = $('#transactionDate')?.value;
  if (!card || !/^\d{4}-\d{2}-\d{2}$/.test(String(purchaseDate || ''))) return;
  const preview = cardInstallmentSchedule({ amount:1, installments:1, purchaseDate, closingDay:card.closingDay, dueDay:card.dueDay });
  input.min = purchaseDate.slice(0, 7);
  input.value = preview[0]?.date?.slice(0, 7) || purchaseDate.slice(0, 7);
  input.dataset.manual = 'false';
}

function syncTransactionRouting() {
  if (!$('#transactionRoute')) return;
  const type = $('#transactionType')?.value || 'expense';
  let route = $('#transactionRoute').value;
  if (type === 'income' && route === 'card') { route = walletsCache.some(item => item.active !== false) ? 'wallet' : 'none'; $('#transactionRoute').value = route; }
  const cardMode = route === 'card' && type === 'expense';
  $('#transactionWalletLabel')?.classList.toggle('hidden', route !== 'wallet');
  $('#transactionCardLabel')?.classList.toggle('hidden', !cardMode);
  $('#transactionInstallmentsLabel')?.classList.toggle('hidden', !cardMode);
  $('#transactionFirstInvoiceLabel')?.classList.toggle('hidden', !cardMode);
  const recurring = $('#transactionRecurring');
  const recurringLabel = recurring?.closest('label');
  if (recurring) {
    const editing = !!$('#transactionEditId')?.value;
    if (cardMode) recurring.checked = false;
    recurring.disabled = editing || cardMode;
    if (recurringLabel) recurringLabel.style.display = editing || cardMode ? 'none' : '';
  }
  const dateLabel = $('#transactionDate')?.closest('label');
  if (dateLabel?.childNodes[0]) dateLabel.childNodes[0].textContent = cardMode ? 'Data da compra' : 'Data';
  const hint = $('#transactionRouteHint');
  if (hint) hint.textContent = cardMode ? 'O valor informado é o total da compra. Escolha o mês da primeira fatura; as parcelas seguintes avançam mês a mês e a carteira pagadora só é movimentada no vencimento.' : route === 'wallet' ? 'Esta movimentação altera o saldo da carteira escolhida.' : 'Lançamentos sem carteira ficam fora dos saldos por instituição.';
  if (cardMode) syncFirstInvoiceMonth();
}

function installDebtFieldsUi() {
  if ($('#positionDebtFields')) return;
  const form = $('#positionForm');
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !submit) return;
  const box = document.createElement('div');
  box.id = 'positionDebtFields';
  box.className = 'debt-fields hidden';
  box.innerHTML = `<span class="card-kicker">COMPOSIÇÃO DA DÍVIDA</span><label>Tipo da dívida<select id="debtKind"><option value="vehicle_financing">Financiamento veicular</option><option value="mortgage">Financiamento habitacional</option><option value="installment">Parcelado</option><option value="personal_loan">Empréstimo pessoal</option><option value="student_loan">Financiamento estudantil</option><option value="other">Outra</option></select></label><label>Instituição / credor<input id="debtInstitution" maxlength="60"></label><div class="form-grid two"><label>Valor original<input id="debtOriginalAmount" type="number" min="0" step="0.01"></label><label>Valor da parcela<input id="debtInstallmentAmount" type="number" min="0" step="0.01"></label><label>Total de parcelas<input id="debtTotalInstallments" type="number" min="1" max="1200"></label><label>Parcelas pagas<input id="debtPaidInstallments" type="number" min="0" max="1200"></label><label>Juros (% a.a.)<input id="debtInterestRate" type="number" min="0" max="100" step="0.01"></label><label>Dia do vencimento<input id="debtDueDay" type="number" min="1" max="31"></label></div><label>Observações<input id="debtNotes" maxlength="240"></label>`;
  form.insertBefore(box, submit);
  $('#positionType').addEventListener('change', syncDebtFields);
  syncDebtFields();
}

function syncDebtFields() {
  const debt = $('#positionType')?.value === 'debt';
  $('#positionDebtFields')?.classList.toggle('hidden', !debt);
  const valueLabel = $('#positionValue')?.closest('label');
  if (valueLabel?.childNodes[0]) valueLabel.childNodes[0].textContent = debt ? 'Saldo devedor atual' : 'Valor atual';
}

function nullableNumber(id, integer = false) {
  const value = $('#'+id)?.value;
  if (value === '' || value == null) return null;
  const number = safeNumber(value);
  return integer ? Math.trunc(number) : number;
}

function readDebtFields(type) {
  if (type !== 'debt') return { debtKind:null, institution:null, originalAmount:null, installmentAmount:null, totalInstallments:null, paidInstallments:null, interestRate:null, dueDay:null, notes:null };
  const totalInstallments = nullableNumber('debtTotalInstallments', true);
  const paidInstallments = nullableNumber('debtPaidInstallments', true);
  if (totalInstallments != null && paidInstallments != null && paidInstallments > totalInstallments) throw new Error('Parcelas pagas não podem superar o total');
  return {
    debtKind: $('#debtKind').value || 'other',
    institution: $('#debtInstitution').value.trim() || null,
    originalAmount: nullableNumber('debtOriginalAmount'),
    installmentAmount: nullableNumber('debtInstallmentAmount'),
    totalInstallments,
    paidInstallments,
    interestRate: nullableNumber('debtInterestRate'),
    dueDay: nullableNumber('debtDueDay', true),
    notes: $('#debtNotes').value.trim() || null
  };
}

function installTransactionPeriodFilter() {
  const filters = $('#transactionsSection .filters');
  const search = $('#txSearch');
  if (!filters || !search || $('#txDateFrom')) return;
  const from = document.createElement('input');
  from.id = 'txDateFrom'; from.type = 'date'; from.title = 'De'; from.setAttribute('aria-label', 'Período inicial');
  const to = document.createElement('input');
  to.id = 'txDateTo'; to.type = 'date'; to.title = 'Até'; to.setAttribute('aria-label', 'Período final');
  const reset = document.createElement('button');
  reset.id = 'txPeriodReset'; reset.type = 'button'; reset.className = 'ghost-btn'; reset.textContent = 'Mês selecionado';
  filters.insertBefore(from, search);
  filters.insertBefore(to, search);
  filters.appendChild(reset);
}

function installMonthlyGoalForm() {
  if ($('#monthlyGoalForm') || !$('#planningForm')) return;
  const form = document.createElement('form');
  form.id = 'monthlyGoalForm';
  form.className = 'panel form-grid';
  form.innerHTML = `
    <div style="grid-column:1/-1"><span class="card-kicker">METAS MENSAIS</span><h2 style="margin:4px 0">Aporte e gasto mensal</h2><p class="muted" style="margin:0">A meta de aporte é definida por você. A meta de gasto é automática: no máximo 60% da renda do mês. Aportes não são tratados como gasto.</p></div>
    <label>Mês<input id="monthlyGoalMonth" type="month" required></label>
    <label>Meta de aporte do mês<input id="monthlyGoalContribution" type="number" min="0" step="50" required></label>
    <div id="monthlySpendingGoalInfo" class="muted" style="align-self:end"></div>
    <div id="monthlyGoalFeedback" class="muted" style="align-self:end"></div>
    <button class="primary" type="submit">Salvar meta de aporte</button>`;
  $('#planningForm').parentNode.insertBefore(form, $('#planningForm'));
  $('#monthlyGoalMonth').value = monthKey(new Date());
  $('#monthlyGoalMonth').addEventListener('change', loadMonthlyGoalForm);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    await runAction(button, async () => {
      const key = $('#monthlyGoalMonth').value;
      const contributionGoal = safeNumber($('#monthlyGoalContribution').value);
      if (!/^\d{4}-\d{2}$/.test(key) || contributionGoal < 0) throw new Error('Metas inválidas');
      const ref = userDoc('monthlyGoals', key);
      const snapshot = await getDoc(ref);
      await setDoc(ref, {
        month: key,
        monthlySurplusGoal: contributionGoal,
        dailySpendGoal: safeNumber(snapshot.data()?.dailySpendGoal),
        createdAt: snapshot.exists() ? snapshot.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await loadAll();
      $('#monthlyGoalMonth').value = key;
      loadMonthlyGoalForm();
    }, 'Meta de aporte atualizada');
  });
}

function loadMonthlyGoalForm() {
  const key = $('#monthlyGoalMonth')?.value;
  if (!key) return;
  const goal = monthlyGoalsCache.find(item => item.id === key || item.month === key);
  const date = dateFromMonthKey(key);
  const metrics = date ? metricsForMonth(date) : null;
  const spendingGoal = monthlySpendingGoal(metrics?.income);
  $('#monthlyGoalContribution').value = goal?.monthlySurplusGoal ?? '';
  $('#monthlySpendingGoalInfo').textContent = metrics?.income > 0
    ? `Meta automática de gasto: ${currency.format(spendingGoal)} · 60% da renda de ${currency.format(metrics.income)}.`
    : 'Meta de gasto: cadastre a renda deste mês para calcular automaticamente 60%.';
  $('#monthlyGoalFeedback').textContent = goal ? 'Meta de aporte cadastrada para este mês.' : 'Nenhuma meta de aporte cadastrada para este mês.';
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
  if ($('#withdrawalWalletId')) $('#withdrawalWalletId').value = walletsCache.find(item => item.active !== false)?.id || '';
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
      walletId: $('#withdrawalWalletId')?.value || null, cardId:null, recurring: false, createdAt: serverTimestamp()
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
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    if (sortField === 'date') {
      const createdCmp = timestampValue(a.createdAt) - timestampValue(b.createdAt);
      if (createdCmp !== 0) return -createdCmp;
      return String(b.id || '').localeCompare(String(a.id || ''));
    }
    return 0;
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
      walletId: tx.walletId || null,
      cardId: null,
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

function dateKeyFromTimestamp(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value?.toDate === 'function') return ymd(value.toDate());
  if (Number.isFinite(value?.seconds)) return ymd(new Date(value.seconds * 1000));
  return '';
}

function walletTrackingStart(walletId) {
  return dateKeyFromTimestamp(walletById(walletId)?.createdAt);
}

function dueCanUseWallet(source, due) {
  if (!source?.walletId) return true;
  const trackingStart = walletTrackingStart(source.walletId);
  return !trackingStart || !due || String(due) >= trackingStart;
}

async function repairAutomationRoutingMetadata() {
  const recurringById = new Map(recurringCache.map(item => [item.id, item]));
  const scheduledById = new Map(scheduledCache.map(item => [item.id, item]));
  let changed = false;

  for (const tx of txCache) {
    const source = tx.sourceType === 'recurring'
      ? recurringById.get(tx.sourceId)
      : tx.sourceType === 'scheduled'
        ? scheduledById.get(tx.sourceId)
        : null;
    if (!source) continue;

    const patch = {};
    const assignMissing = (key, value) => {
      if ((tx[key] == null || tx[key] === '') && value != null && value !== '') patch[key] = value;
    };

    if (dueCanUseWallet(source, tx.date)) assignMissing('walletId', source.walletId || null);
    if (tx.sourceType === 'scheduled') {
      assignMissing('cardId', source.cardId || null);
      assignMissing('purchaseDate', source.purchaseDate || null);
      assignMissing('installmentGroupId', source.installmentGroupId || null);
      assignMissing('installmentNumber', source.installmentNumber ?? null);
      assignMissing('installmentTotal', source.installmentTotal ?? null);
    }

    if (Object.keys(patch).length) {
      await updateDoc(userDoc('transactions', tx.id), patch);
      changed = true;
    }
  }

  return changed;
}

async function repairRecurringWalletAssignments() {
  const activeWallets = walletsCache.filter(item => item.active !== false);
  if (activeWallets.length !== 1) return false;
  const walletId = activeWallets[0].id;
  let changed = false;
  for (const recurring of recurringCache.filter(item => !item.walletId && !item.cardId)) {
    await updateDoc(userDoc('recurring', recurring.id), { walletId, updatedAt: serverTimestamp() });
    changed = true;
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
      if (!shouldMaterializeRecurring(due, today)) break;
      if (!dueCanUseWallet(recurring, due)) {
        cursor.setMonth(cursor.getMonth() + 1);
        continue;
      }
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
          walletId: recurring.walletId || null,
          cardId: null,
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
      const id = scheduledTransactionId(scheduled, due);
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
          walletId: scheduled.walletId || null,
          cardId: scheduled.cardId || null,
          purchaseDate: scheduled.purchaseDate || null,
          installmentGroupId: scheduled.installmentGroupId || null,
          installmentNumber: scheduled.installmentNumber ?? null,
          installmentTotal: scheduled.installmentTotal ?? null,
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

async function synchronizeDateRollover() {
  const now = new Date();
  const today = ymd(now);
  if (today === observedToday || !user || rolloverSyncBusy) return;
  const previousDay = observedToday;
  rolloverSyncBusy = true;
  observedToday = today;
  try {
    if (monthKey(selectedMonth) === previousDay.slice(0, 7)) {
      selectedMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (selectedYear === Number(previousDay.slice(0, 4))) selectedYear = now.getFullYear();
    await loadAll();
  } catch (error) {
    console.error('Falha ao sincronizar a virada de data.', error);
  } finally {
    rolloverSyncBusy = false;
  }
}

async function loadAll() {
  await ensureUserRoot();
  const [transactions, positions, planning, monthlyGoals, wallets, cards] = await Promise.all([
    loadCollection('transactions','date','desc'),
    loadCollection('positions','createdAt','desc'),
    getDoc(userDoc('config','planning')),
    loadCollection('monthlyGoals','month','desc'),
    loadCollection('wallets','createdAt','asc'),
    loadCollection('cards','createdAt','asc')
  ]);
  txCache = transactions;
  positionsCache = positions;
  settings = planning.exists() ? planning.data() : {};
  monthlyGoalsCache = monthlyGoals;
  walletsCache = wallets;
  cardsCache = cards;

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
    const walletAssignmentsRepaired = await repairRecurringWalletAssignments();
    if (repaired || walletAssignmentsRepaired) recurringCache = await loadCollection('recurring','createdAt','desc');
    await processAutomations();
    [txCache, recurringCache, scheduledCache] = await Promise.all([
      loadCollection('transactions','date','desc'),
      loadCollection('recurring','createdAt','desc'),
      loadCollection('scheduled','dueDate','asc')
    ]);
    const routingRepaired = await repairAutomationRoutingMetadata();
    if (routingRepaired) txCache = await loadCollection('transactions','date','desc');
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
  renderAccounts();
  renderPlanning();
}

function renderDashboard() {
  const metrics = metricsForMonth(selectedMonth);
  const positions = calcPositions();
  const goal = goalFor(selectedMonth);
  const prevDate = new Date(selectedMonth); prevDate.setMonth(prevDate.getMonth() - 1);
  const prev = metricsForMonth(prevDate);
  const reserve = reserveMetrics({
    reserve: positions.reserve,
    transactions: txCache,
    recurring: recurringCache,
    todayYmd: ymd(new Date()),
    targetMonths: safeNumber(settings.reserveTargetMonths) || 6
  });
  const spending = spendingForMonth(selectedMonth);
  const spendingGoal = monthlySpendingGoal(metrics.income);
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const score = scoreMetrics({
    contribution: metrics.contribution,
    contributionGoal,
    spending: spending.totalExpenses,
    spendingGoal,
    reserveProgress: reserve.progress
  });

  $('#monthLabel').textContent = monthLabel(selectedMonth);
  $('#netWorth').textContent = currency.format(positions.netWorth);
  $('#netWorthContext').textContent = `${currency.format(positions.assets)} em ativos · ${currency.format(positions.debts)} em dívidas (informativo)`;
  $('#monthBalance').textContent = currency.format(metrics.balance);
  $('#balanceTrend').textContent = prev.totalOut === 0 && prev.income === 0
    ? 'Sem base anterior'
    : `${metrics.balance >= prev.balance ? '▲' : '▼'} ${currency.format(Math.abs(metrics.balance - prev.balance))} vs. mês anterior`;
  $('#savingRate').textContent = metrics.contributionRate == null ? '—' : `${metrics.contributionRate.toFixed(1)}%`;
  if (metrics.income > 0) {
    $('#savingStatus').textContent = metrics.withdrawal > 0
      ? `Líquido ${currency.format(metrics.contribution)} · aportes ${currency.format(metrics.grossContribution)} · resgates ${currency.format(metrics.withdrawal)}`
      : `${currency.format(metrics.contribution)} aportados de ${currency.format(metrics.income)} considerados no mês`;
  } else {
    $('#savingStatus').textContent = metrics.withdrawal > 0
      ? `Resgate de ${currency.format(metrics.withdrawal)} para o saldo do mês`
      : 'Sem receita lançada ou recorrente no mês';
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

  renderScoreAndPet(score, { metrics, goal, spending, spendingGoal, reserve });
  renderCashflow();
  renderDonut(metrics);
  renderInsights(metrics, positions, spending, spendingGoal, reserve);
  renderMissions(metrics, goal, spending, spendingGoal, reserve);
  renderForecast();
  renderUpcoming();
  $('#recentTransactions').innerHTML = metrics.rows.slice()
    .sort((a,b) => String(b.date).localeCompare(String(a.date)))
    .slice(0,6).map(txRow).join('') || '<div class="empty-state">Nenhum lançamento.</div>';
}

function renderScoreAndPet(score, context) {
  const { metrics, goal, spending, spendingGoal, reserve } = context;
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const health = score.score;
  $('#financeScore').textContent = health == null ? '—' : String(health);
  $('#scoreRing').style.setProperty('--p', `${health ?? 0}%`);
  $('#scoreLabel').textContent = health == null ? 'Aguardando metas' : health >= 85 ? 'Excelente' : health >= 70 ? 'Forte' : health >= 50 ? 'Em evolução' : 'Atenção';
  $('#scoreHint').textContent = health == null
    ? 'Defina a meta de aporte e registre a renda do mês para calcular o score.'
    : `Score: aporte 40% + gasto mensal 35%${reserve.progress != null ? ' + reserva 25%' : ''}${score.completeness < 100 ? ' · parcial' : ''}.`;
  const xp = Math.max(0, txCache.length * 2 + (health ?? 0) * 4 + (reserve.progress === 1 ? 200 : 0));
  $('#xpPill').textContent = `${Math.round(xp)} XP`;
  $('#levelPill').textContent = `Nível ${Math.max(1, Math.floor(xp / 500) + 1)}`;

  let avatar = '🐷', state = 'Aguardando metas', message = 'Defina a meta de aporte e registre sua renda para eu avaliar sua disciplina financeira.';
  if (health != null) {
    if (health >= 85) { avatar = '🐷✨'; state = 'Radiante'; message = 'Aporte, gasto mensal e reserva estão muito bem alinhados.'; }
    else if (health >= 70) { state = 'Saudável'; message = 'Boa disciplina. Mantenha o gasto mensal dentro de 60% da renda.'; }
    else if (health >= 50) { avatar = '🐽'; state = 'Em atenção'; message = 'Uma das metas está pressionando sua saúde financeira.'; }
    else { avatar = '😵‍💫'; state = 'Crítico'; message = 'Aporte, gasto mensal ou reserva precisam de correção.'; }
  }
  $('#petAvatar').textContent = avatar;
  $('#petName').textContent = `Cofrinho · ${state}`;
  $('#petMessage').textContent = message;
  $('#petHealthBadge').textContent = health == null ? 'Saúde —' : `Saúde ${health}%`;
  $('#petHealthBadge').className = `health-badge ${health == null ? 'warn' : health >= 70 ? 'good' : health >= 45 ? 'warn' : 'bad'}`;
  $('#petHealthBar').style.width = `${health ?? 0}%`;
  const vitals = [
    ['Aportes', contributionGoal ? `${Math.round(clamp(metrics.contribution / contributionGoal, 0, 1) * 100)}%` : '—'],
    ['Gasto mês', spendingGoal > 0 ? `${currency.format(spending.totalExpenses)} / ${currency.format(spendingGoal)}` : '—'],
    ['Reserva', reserve.months != null ? `${reserve.months.toFixed(1)} meses` : '—']
  ];
  $('#petVitals').innerHTML = vitals.map(([a,b]) => `<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  $('#surplusGoalStatus').textContent = currency.format(metrics.contribution);
  $('#surplusGoalDetail').textContent = contributionGoal
    ? `Meta ${currency.format(contributionGoal)} · ${metrics.contribution >= contributionGoal ? 'atingida' : 'faltam ' + currency.format(contributionGoal - metrics.contribution)}`
    : 'Defina a meta mensal em Metas';
  $('#dailyGoalStatus').textContent = currency.format(spending.totalExpenses);
  $('#dailyGoalDetail').textContent = spendingGoal > 0
    ? `Meta ${currency.format(spendingGoal)} · 60% da renda · ${spending.totalExpenses <= spendingGoal ? 'dentro da meta' : 'acima em ' + currency.format(spending.totalExpenses - spendingGoal)}`
    : 'Cadastre a renda do mês para calcular a meta de 60%';
}

function txRow(tx) {
  const wallet = walletById(tx.walletId);
  const card = cardById(tx.cardId);
  const installment = tx.installmentTotal ? ` · ${tx.installmentNumber}/${tx.installmentTotal}` : '';
  const account = card ? ` · ${esc(card.name)}` : wallet ? ` · ${esc(wallet.name)}` : '';
  const source = tx.sourceType === 'recurring' ? (tx.projected ? ' · recorrente prevista' : ' · recorrente') : tx.sourceType === 'scheduled' ? (tx.projected ? ' · prevista' : ' · agendada') : '';
  let actions = '';
  if (tx.projected && tx.installmentGroupId) actions = `<button class="mini-btn" data-edit-installment-group="${esc(tx.installmentGroupId)}">Editar</button><span class="muted">Previsto</span>`;
  else if (tx.projected) actions = '<span class="muted">Previsto</span>';
  else if (tx.installmentGroupId) actions = `<button class="mini-btn" data-edit-installment-group="${esc(tx.installmentGroupId)}">Editar futuras</button><span class="muted">Parcela</span>`;
  else if (isWithdrawal(tx)) actions = `<button class="mini-btn danger" data-delete-tx="${tx.id}">Excluir</button>`;
  else if (tx.sourceType === 'scheduled') actions = `<button class="mini-btn" data-edit-tx="${tx.id}">Editar</button><span class="muted">Agendado</span>`;
  else if (tx.sourceType) actions = '<span class="muted">Automático</span>';
  else actions = `<button class="mini-btn" data-edit-tx="${tx.id}">Editar</button><button class="mini-btn danger" data-delete-tx="${tx.id}">Excluir</button>`;
  return `<div class="list-row"><div class="list-icon">${tx.type === 'expense' ? '−' : '+'}</div><div class="list-main"><strong>${esc(tx.description || tx.category)}</strong><small>${esc(tx.category)} · ${formatDate(tx.date)}${source}${installment}${account}${isContribution(tx) ? ' · aporte' : ''}${isWithdrawal(tx) ? ' · resgate patrimonial' : ''}</small></div><div><div class="money ${tx.type}">${tx.type === 'expense' ? '−' : '+'}${currency.format(safeNumber(tx.amount))}</div><div class="row-actions">${actions}</div></div></div>`;
}

function renderTransactions() {
  const type = $('#txTypeFilter').value;
  const search = $('#txSearch').value.trim().toLowerCase();
  const dateFrom = $('#txDateFrom')?.value || '';
  const dateTo = $('#txDateTo')?.value || '';
  let list = txCache.filter(tx => !isArchivedTransaction(tx)).sort((a,b) => String(b.date).localeCompare(String(a.date)));
  if (!dateFrom && !dateTo) list = metricsForMonth(selectedMonth).rows.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));
  if (dateFrom) list = list.filter(tx => String(tx.date || '') >= dateFrom);
  if (dateTo) list = list.filter(tx => String(tx.date || '') <= dateTo);
  if (type !== 'all') list = list.filter(tx => tx.type === type);
  if (search) list = list.filter(tx => String(tx.description || '').toLowerCase().includes(search) || String(tx.category || '').toLowerCase().includes(search));
  $('#transactionsList').innerHTML = list.map(txRow).join('') || '<div class="empty-state">Nenhum lançamento no período informado.</div>';
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
    const m = metricsForMonth(d);
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

function renderInsights(metrics, positions, spending, spendingGoal, reserve) {
  const insights = [];
  const prev = new Date(selectedMonth); prev.setMonth(prev.getMonth() - 1);
  const previous = metricsForMonth(prev);
  if (previous.consumption > 0) {
    const delta = (metrics.consumption - previous.consumption) / previous.consumption * 100;
    insights.push([delta <= 0 ? '📉' : '📈', 'Gastos vs. mês anterior', `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% de variação no consumo.`]);
  }
  const cats = {};
  metrics.rows.filter(tx => tx.type === 'expense' && !isContribution(tx)).forEach(tx => cats[tx.category] = (cats[tx.category] || 0) + safeNumber(tx.amount));
  const top = Object.entries(cats).sort((a,b) => b[1] - a[1])[0];
  if (top) insights.push(['🎯','Maior categoria',`${top[0]} representa ${(metrics.consumption ? top[1] / metrics.consumption * 100 : 0).toFixed(1)}% dos gastos.`]);
  insights.push(['🛟','Reserva', reserve.months != null
    ? `Cobertura de ${reserve.months.toFixed(1)} meses. Valor considerado: ${currency.format(positions.reserve)} = ${currency.format(positions.manualReserve)} cadastrados + ${currency.format(positions.contributionAssets)} em aportes líquidos.`
    : 'Ainda não há base recorrente válida para dimensionar a reserva.']);
  if (spendingGoal > 0) {
    insights.push([
      spending.totalExpenses <= spendingGoal ? '✅' : '⚠️',
      'Meta de gasto mensal',
      `${currency.format(spending.totalExpenses)} de ${currency.format(spendingGoal)} (60% da renda). Aportes não entram como gasto.`
    ]);
  } else {
    insights.push(['ℹ️','Meta de gasto mensal','Cadastre a renda do mês para calcular automaticamente o limite de 60%.']);
  }
  if (positions.debts > 0) insights.push(['📉','Dívidas',`Saldo devedor cadastrado: ${currency.format(positions.debts)}.`]);
  $('#insightsList').innerHTML = insights.map(item => `<div class="insight"><div class="insight-icon">${item[0]}</div><div><strong>${item[1]}</strong><p>${item[2]}</p></div></div>`).join('');
}

function renderMissions(metrics, goal, spending, spendingGoal, reserve) {
  const contributionGoal = safeNumber(goal?.monthlySurplusGoal);
  const targetMonths = safeNumber(settings.reserveTargetMonths) || 6;
  const missions = [
    ['📈','Meta de aportes', contributionGoal ? `${currency.format(metrics.contribution)} / ${currency.format(contributionGoal)}` : 'Defina uma meta mensal', contributionGoal ? clamp(metrics.contribution / contributionGoal,0,1) : 0],
    ['🎯','Gasto mensal ≤ 60% da renda', spendingGoal > 0 ? `${currency.format(spending.totalExpenses)} / ${currency.format(spendingGoal)}` : 'Cadastre a renda do mês', spendingGoal > 0 ? (spending.totalExpenses <= spendingGoal ? 1 : clamp(spendingGoal / Math.max(spending.totalExpenses,.01),0,1)) : 0],
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
    const exists = txCache.some(tx => tx.id === scheduledTransactionId(scheduled, due));
    if (!exists) out.push({ id:scheduledTransactionId(scheduled, due), name: scheduled.name, description:scheduled.description || scheduled.name, amount: safeNumber(scheduled.amount), type: scheduled.type, date: due, category: scheduled.category, icon:scheduled.installmentGroupId ? '💳' : '📅', sourceType:'scheduled', sourceId:scheduled.id, walletId:scheduled.walletId || null, cardId:scheduled.cardId || null, purchaseDate:scheduled.purchaseDate || null, installmentGroupId:scheduled.installmentGroupId || null, installmentNumber:scheduled.installmentNumber || null, installmentTotal:scheduled.installmentTotal || null, projected:true });
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
    if (due && due >= today && due <= end) rows.push({ date: due, name: item.name, amount: item.amount, icon:item.installmentGroupId ? '💳' : '📅' });
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
  const regularScheduled = scheduledCache.filter(item => !item.installmentGroupId);
  const installmentGroups = new Set(scheduledCache.filter(item => item.status === 'active' && item.installmentGroupId).map(item => item.installmentGroupId));
  $('#recurringCount').textContent = `${recurringCache.filter(item => item.active).length} ativas`;
  $('#scheduledCount').textContent = `${regularScheduled.filter(item => item.status === 'active').length} futuras${installmentGroups.size ? ` · ${installmentGroups.size} parceladas` : ''}`;
  $('#recurringList').innerHTML = recurringCache.map(item => `<div class="agenda-item ${item.active ? '' : 'inactive'}"><div class="agenda-icon">🔁</div><div><strong>${esc(item.name)}</strong><small>${currency.format(safeNumber(item.amount))} · dia ${item.dayOfMonth} · ${esc(item.category)}${walletById(item.walletId) ? ` · ${esc(walletById(item.walletId).name)}` : ''}</small></div><div class="agenda-actions"><button class="mini-btn" data-edit-rec="${item.id}">Editar</button><button class="mini-btn danger" data-del-rec="${item.id}">Excluir</button></div></div>`).join('') || '<div class="empty-state">Nenhuma recorrência.</div>';
  $('#scheduledList').innerHTML = regularScheduled.map(item => {
    const postedTx = item.status === 'posted' ? latestScheduledTransaction(item.id) : null;
    const editAction = item.status === 'active' ? `<button class="mini-btn" data-edit-sch="${item.id}">Editar</button>` : postedTx ? `<button class="mini-btn" data-edit-tx="${postedTx.id}">Editar lançamento</button>` : '';
    return `<div class="agenda-item ${item.status === 'active' ? '' : 'inactive'}"><div class="agenda-icon">📅</div><div><strong>${esc(item.name)}</strong><small>${currency.format(safeNumber(item.amount))} · ${formatDate(item.dueDate)} · ${item.frequency === 'annual' ? 'anual' : item.status === 'posted' ? 'lançada' : 'uma vez'}${walletById(item.walletId) ? ` · ${esc(walletById(item.walletId).name)}` : ''}</small></div><div class="agenda-actions">${editAction}<button class="mini-btn danger" data-del-sch="${item.id}">Excluir</button></div></div>`;
  }).join('') || '<div class="empty-state">Nenhuma conta agendada. Parcelamentos ficam em Carteiras.</div>';
}

function renderPositions() {
  const positions = calcPositions();
  $('#assetsTotal').textContent = currency.format(positions.assets);
  $('#debtsTotal').textContent = currency.format(positions.debts);
  $('#patrimonyNetWorth').textContent = currency.format(positions.netWorth);

  const hasContributionHistory = txCache.some(isContribution) || txCache.some(isWithdrawal);
  const autoRow = hasContributionHistory
    ? `<div class="list-row"><div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · integra a reserva de emergência · aportes realizados menos resgates</small></div><div><div class="money income">${currency.format(positions.contributionAssets)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution ${positions.contributionAssets > 0 ? '' : 'disabled'}>Mover para saldo</button></div></div></div>`
    : '';
  const manualRows = positionsCache.map(item => {
    const debt = item.type === 'debt';
    const parts = [];
    if (debt && item.debtKind) parts.push(debtKindLabel(item.debtKind));
    if (debt && item.institution) parts.push(esc(item.institution));
    if (debt && item.totalInstallments) parts.push(`${safeNumber(item.paidInstallments)} de ${safeNumber(item.totalInstallments)} parcelas pagas`);
    if (debt && safeNumber(item.installmentAmount) > 0) parts.push(`parcela ${currency.format(safeNumber(item.installmentAmount))}`);
    if (debt && safeNumber(item.dueDay) > 0) parts.push(`vence dia ${safeNumber(item.dueDay)}`);
    const detail = debt ? (parts.join(' · ') || 'Dívida') : item.type === 'reserve' ? 'Reserva' : 'Ativo';
    const progress = debt && item.totalInstallments ? clamp(safeNumber(item.paidInstallments) / safeNumber(item.totalInstallments), 0, 1) : null;
    return `<div class="list-row debt-row"><div class="list-icon">${debt ? '−' : '+'}</div><div class="list-main"><strong>${esc(item.name)}</strong><small>${detail}</small>${progress != null ? `<div class="debt-progress"><i style="width:${progress * 100}%"></i></div>` : ''}</div><div><div class="money ${debt ? 'expense' : 'income'}">${currency.format(safeNumber(item.value))}</div><div class="row-actions"><button class="mini-btn" data-edit-position="${item.id}">Editar</button><button class="mini-btn danger" data-delete-position="${item.id}">Excluir</button></div></div></div>`;
  }).join('');
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
  if (positions.reserve > 0) items.push(`Reserva considerada: <b>${currency.format(positions.reserve)}</b> = <b>${currency.format(positions.manualReserve)}</b> cadastrados como reserva + <b>${currency.format(positions.contributionAssets)}</b> em aportes líquidos.`);
  if (positions.debts > 0) items.push(`Dívidas cadastradas: <b>${currency.format(positions.debts)}</b>. São exibidas para acompanhamento, mas não reduzem o patrimônio; pagamentos efetivos entram no fluxo de caixa.`);
  if (reserve.months != null) items.push(`A reserva atual cobre <b>${reserve.months.toFixed(1)} meses</b>, usando despesas recorrentes ativas de <b>${currency.format(reserve.monthlyBase)}</b> por mês.`);
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
  syncTransactionRouting();
}

function openInstallmentGroup(groupId) {
  const active = scheduledCache.filter(item => item.status === 'active' && item.installmentGroupId === groupId).sort((a,b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  const posted = txCache.filter(item => item.installmentGroupId === groupId).sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (!active.length) return toast('Não há parcelas futuras para editar.');
  const sample = active[0];
  const hasPosted = posted.length > 0;
  $('#transactionForm').reset();
  $('#transactionEditId').value = `installment:${groupId}`;
  const title = $('#transactionDialog h2');
  if (title) title.textContent = 'Editar compra no cartão';
  setTxType('expense', sample.category);
  $('#transactionAmount').value = active.reduce((sum, item) => sum + safeNumber(item.amount), 0).toFixed(2);
  $('#transactionDescription').value = sample.description || sample.name || '';
  $('#transactionDate').value = sample.purchaseDate || ymd(new Date());
  $('#transactionRoute').value = 'card';
  $('#transactionCardId').value = sample.cardId || '';
  $('#transactionInstallments').value = String(active.length);
  $('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);
  $('#transactionFirstInvoiceMonth').dataset.manual = 'true';
  if (hasPosted) {
    const lastPostedMonth = String(posted.at(-1)?.date || '').slice(0, 7);
    const lastPostedDate = dateFromMonthKey(lastPostedMonth);
    if (lastPostedDate) {
      lastPostedDate.setMonth(lastPostedDate.getMonth() + 1);
      $('#transactionFirstInvoiceMonth').min = monthKey(lastPostedDate);
    }
  } else {
    $('#transactionFirstInvoiceMonth').min = String(sample.purchaseDate || '').slice(0, 7);
  }
  const invoiceLabel = $('#transactionFirstInvoiceLabel');
  if (invoiceLabel?.childNodes[0]) invoiceLabel.childNodes[0].textContent = hasPosted ? 'Mês da próxima fatura' : 'Mês da primeira fatura';
  $('#transactionRoute').disabled = true;
  $('#transactionCardId').disabled = hasPosted;
  $('#transactionDate').disabled = hasPosted;
  $('#transactionInstallments').disabled = hasPosted;
  const amountLabel = $('#transactionAmount')?.closest('label');
  if (amountLabel?.childNodes[0]) amountLabel.childNodes[0].textContent = hasPosted ? 'Valor restante das parcelas futuras' : 'Valor total da compra';
  syncTransactionRouting();
  const hint = $('#transactionRouteHint');
  if (hint && hasPosted) hint.textContent += ` ${posted.length} parcela(s) já realizada(s) permanecem no histórico; a edição altera somente as ${active.length} futuras.`;
  $('#transactionDialog').showModal();
}

async function saveInstallmentGroupEdit(groupId, { amount, category, description, purchaseDate }) {
  const active = scheduledCache.filter(item => item.status === 'active' && item.installmentGroupId === groupId).sort((a,b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  const posted = txCache.filter(item => item.installmentGroupId === groupId).sort((a,b) => safeNumber(a.installmentNumber) - safeNumber(b.installmentNumber));
  if (!active.length) throw new Error('Não há parcelas futuras para editar');
  const sample = active[0];
  const hasPosted = posted.length > 0;
  const card = cardById($('#transactionCardId').value);
  let installments = Math.trunc(safeNumber($('#transactionInstallments').value || active.length));
  if (hasPosted) installments = active.length;
  const firstInvoiceMonth = $('#transactionFirstInvoiceMonth').value;
  if (!card || card.active === false || installments < 1 || installments > 60 || !/^\d{4}-\d{2}$/.test(firstInvoiceMonth)) throw new Error('Cartão, parcelas ou primeira fatura inválidos');
  if (hasPosted && (card.id !== sample.cardId || purchaseDate !== sample.purchaseDate)) throw new Error('Cartão e data da compra não podem mudar após uma parcela realizada');
  const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay:card.closingDay, dueDay:card.dueDay, firstInvoiceMonth });
  if (schedule.length !== installments) throw new Error('A primeira fatura não pode vencer antes da compra e o valor deve comportar as parcelas');
  const lastPostedDate = posted.at(-1)?.date || '';
  if (hasPosted && schedule[0]?.date <= lastPostedDate) throw new Error('A próxima fatura deve ser posterior à última parcela já realizada');
  const existingNumbers = active.map(item => Math.trunc(safeNumber(item.installmentNumber))).filter(Boolean);
  const totalInstallments = hasPosted ? Math.trunc(safeNumber(sample.installmentTotal) || (posted.length + active.length)) : installments;
  const nextIds = new Set();
  for (let index = 0; index < schedule.length; index += 1) {
    const part = schedule[index];
    const installmentNumber = hasPosted ? (existingNumbers[index] || posted.length + index + 1) : part.installmentNumber;
    const scheduledId = `inst_${groupId}_${String(installmentNumber).padStart(3,'0')}`;
    nextIds.add(scheduledId);
    await setDoc(userDoc('scheduled', scheduledId), {
      name: `${description || category} · ${installmentNumber}/${totalInstallments}`,
      type:'expense', amount:part.amount, category, description:description || category,
      dueDate:part.date, frequency:'once', status:'active',
      walletId:card.paymentWalletId, cardId:card.id, purchaseDate,
      installmentGroupId:groupId, installmentNumber, installmentTotal:totalInstallments,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
  }
  for (const item of active) {
    if (!nextIds.has(item.id)) await deleteDoc(userDoc('scheduled', item.id));
  }
}

function openTransaction(tx = null) {
  if (tx?.installmentGroupId) return openInstallmentGroup(tx.installmentGroupId);
  $('#transactionRoute').disabled = false;
  $('#transactionCardId').disabled = false;
  $('#transactionDate').disabled = false;
  $('#transactionInstallments').disabled = false;
  if ($('#transactionFirstInvoiceMonth')) { $('#transactionFirstInvoiceMonth').value = ''; $('#transactionFirstInvoiceMonth').dataset.manual = 'false'; }
  const invoiceLabel = $('#transactionFirstInvoiceLabel');
  if (invoiceLabel?.childNodes[0]) invoiceLabel.childNodes[0].textContent = 'Mês da primeira fatura';
  const amountLabel = $('#transactionAmount')?.closest('label');
  if (amountLabel?.childNodes[0]) amountLabel.childNodes[0].textContent = 'Valor';
  if (tx && (tx.sourceType === 'recurring' || tx.projected || isWithdrawal(tx))) return;
  $('#transactionForm').reset();
  $('#transactionEditId').value = tx?.id || '';
  const title = $('#transactionDialog h2');
  if (title) title.textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
  setTxType(tx?.type || 'expense', tx?.category);
  $('#transactionAmount').value = tx?.amount ?? '';
  $('#transactionDescription').value = tx?.description || '';
  $('#transactionDate').value = tx?.date || ymd(new Date());
  $('#transactionRecurring').checked = !!tx?.recurring;
  const defaultWallet = tx?.walletId || walletsCache.find(item => item.active !== false)?.id || '';
  $('#transactionRoute').value = tx?.cardId ? 'card' : defaultWallet ? 'wallet' : 'none';
  $('#transactionWalletId').value = defaultWallet;
  $('#transactionCardId').value = tx?.cardId || cardsCache.find(item => item.active !== false)?.id || '';
  $('#transactionInstallments').value = String(tx?.installmentTotal || 1);
  $('#transactionRecurring').disabled = !!tx;
  const recurringLabel = $('#transactionRecurring').closest('label');
  if (recurringLabel) recurringLabel.style.display = tx ? 'none' : '';
  syncTransactionRouting();
  $('#transactionDialog').showModal();
}

function openPosition(position = null) {
  $('#positionForm').reset();
  $('#positionEditId').value = position?.id || '';
  $('#positionDialogTitle').textContent = position ? 'Editar posição' : 'Nova posição';
  $('#positionType').value = position?.type || 'asset';
  $('#positionName').value = position?.name || '';
  $('#positionValue').value = position?.value ?? '';
  $('#debtKind').value = position?.debtKind || 'vehicle_financing';
  $('#debtInstitution').value = position?.institution || '';
  $('#debtOriginalAmount').value = position?.originalAmount ?? '';
  $('#debtInstallmentAmount').value = position?.installmentAmount ?? '';
  $('#debtTotalInstallments').value = position?.totalInstallments ?? '';
  $('#debtPaidInstallments').value = position?.paidInstallments ?? '';
  $('#debtInterestRate').value = position?.interestRate ?? '';
  $('#debtDueDay').value = position?.dueDay ?? '';
  $('#debtNotes').value = position?.notes || '';
  syncDebtFields();
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
  if ($('#recurringWalletId')) $('#recurringWalletId').value = item?.walletId || walletsCache.find(row => row.active !== false)?.id || '';
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
  if ($('#scheduledWalletId')) $('#scheduledWalletId').value = item?.walletId || walletsCache.find(row => row.active !== false)?.id || '';
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
document.addEventListener('change', event => {
  if (event.target.matches?.('#txDateFrom, #txDateTo')) renderTransactions();
});
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
    const route = $('#transactionRoute')?.value || 'none';
    if (!(amount > 0) || !['income','expense'].includes(type) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Lançamento inválido');
    const installmentGroupEdit = id.startsWith('installment:') ? id.slice('installment:'.length) : '';
    if (installmentGroupEdit) {
      if (type !== 'expense' || route !== 'card') throw new Error('Compra no cartão inválida');
      await saveInstallmentGroupEdit(installmentGroupEdit, { amount, category, description, purchaseDate:date });
    } else if (id) {
      const walletId = route === 'wallet' ? $('#transactionWalletId').value || null : null;
      if (walletsCache.some(item => item.active !== false) && route === 'wallet' && !walletId) throw new Error('Selecione a carteira');
      await updateDoc(userDoc('transactions', id), { type, amount, category, description, date, walletId, cardId:null });
    } else if (route === 'card') {
      if (type !== 'expense') throw new Error('Cartão aceita apenas despesas');
      const card = cardById($('#transactionCardId').value);
      const installments = Math.trunc(safeNumber($('#transactionInstallments').value || 1));
      const firstInvoiceMonth = $('#transactionFirstInvoiceMonth').value;
      if (!card || card.active === false || installments < 1 || installments > 60 || !/^\d{4}-\d{2}$/.test(firstInvoiceMonth)) throw new Error('Cartão, parcelamento ou primeira fatura inválidos');
      const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate:date, closingDay:card.closingDay, dueDay:card.dueDay, firstInvoiceMonth });
      if (schedule.length !== installments) throw new Error('A primeira fatura não pode vencer antes da compra e o valor deve comportar as parcelas');
      const groupId = newEntityId('grp');
      for (const part of schedule) {
        const scheduledId = `inst_${groupId}_${String(part.installmentNumber).padStart(3,'0')}`;
        await setDoc(userDoc('scheduled', scheduledId), {
          name: `${description || category} · ${part.installmentNumber}/${part.installmentTotal}`,
          type:'expense', amount:part.amount, category, description:description || category,
          dueDate:part.date, frequency:'once', status:'active',
          walletId:card.paymentWalletId, cardId:card.id, purchaseDate:date,
          installmentGroupId:groupId, installmentNumber:part.installmentNumber, installmentTotal:part.installmentTotal,
          createdAt:serverTimestamp(), updatedAt:serverTimestamp()
        });
      }
    } else {
      const walletId = route === 'wallet' ? $('#transactionWalletId').value || null : null;
      if (walletsCache.some(item => item.active !== false) && route !== 'wallet') throw new Error('Selecione uma carteira para o lançamento');
      if (route === 'wallet' && !walletId) throw new Error('Selecione a carteira');
      const recurring = $('#transactionRecurring').checked;
      const ref = await addDoc(userCol('transactions'), { type, amount, category, description, date, walletId, cardId:null, recurring, createdAt: serverTimestamp() });
      if (recurring && agendaAvailable) {
        const day = Number(date.slice(8,10));
        await setDoc(userDoc('recurring', `legacy_${ref.id}`), {
          name: description || category,
          type, amount, category, description,
          dayOfMonth: day, startDate: date, endDate: '', active: true, walletId,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
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
    const data = { type, name, value, ...readDebtFields(type) };
    if (id) await updateDoc(userDoc('positions', id), data);
    else await addDoc(userCol('positions'), { ...data, createdAt: serverTimestamp() });
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
    const walletId = $('#recurringWalletId')?.value || null;
    if (walletsCache.some(item => item.active !== false) && !walletId) throw new Error('Selecione a carteira da recorrência');
    const data = { name, type, amount, category, description: name, dayOfMonth, startDate, endDate, active, walletId, cardId:null, updatedAt: serverTimestamp() };
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
    const walletId = $('#scheduledWalletId')?.value || null;
    if (walletsCache.some(item => item.active !== false) && !walletId) throw new Error('Selecione a carteira do compromisso');
    const data = { name, type, amount, category, description: name, dueDate, frequency, status:'active', walletId, cardId:null, updatedAt: serverTimestamp() };
    if (id) await updateDoc(userDoc('scheduled', id), data);
    else await addDoc(userCol('scheduled'), { ...data, createdAt: serverTimestamp() });
    $('#scheduledDialog').close();
    await loadAll();
  }, 'Conta agendada salva');
});

document.addEventListener('click', async event => {
  const target = event.target;
  const periodReset = target.closest?.('#txPeriodReset');
  if (periodReset) {
    event.preventDefault();
    if ($('#txDateFrom')) $('#txDateFrom').value = '';
    if ($('#txDateTo')) $('#txDateTo').value = '';
    renderTransactions();
    return;
  }
  const withdraw = target.closest?.('[data-withdraw-contribution]');
  if (withdraw) { event.preventDefault(); openWithdrawal(); return; }
  if (target.dataset.editWallet) return openWallet(walletById(target.dataset.editWallet));
  if (target.dataset.editCard) return openCard(cardById(target.dataset.editCard));
  if (target.dataset.toggleWallet) {
    const wallet = walletById(target.dataset.toggleWallet);
    if (!wallet) return;
    if (wallet.active !== false && cardsCache.some(card => card.active !== false && card.paymentWalletId === wallet.id)) return toast('Altere primeiro a carteira de pagamento dos cartões ativos.');
    await runAction(target, async () => { await updateDoc(userDoc('wallets', wallet.id), { active:wallet.active === false, updatedAt:serverTimestamp() }); await loadAll(); }, wallet.active === false ? 'Carteira reativada' : 'Carteira arquivada');
    return;
  }
  if (target.dataset.toggleCard) {
    const card = cardById(target.dataset.toggleCard);
    if (!card) return;
    await runAction(target, async () => { await updateDoc(userDoc('cards', card.id), { active:card.active === false, updatedAt:serverTimestamp() }); await loadAll(); }, card.active === false ? 'Cartão reativado' : 'Cartão arquivado');
    return;
  }
  if (target.dataset.editInstallmentGroup) { openInstallmentGroup(target.dataset.editInstallmentGroup); return; }
  if (target.dataset.deleteInstallmentGroup && confirm('Excluir todas as parcelas futuras desta compra? Parcelas já lançadas permanecem no histórico.')) {
    const groupId = target.dataset.deleteInstallmentGroup;
    await runAction(target, async () => { for (const item of scheduledCache.filter(row => row.status === 'active' && row.installmentGroupId === groupId)) await deleteDoc(userDoc('scheduled', item.id)); await loadAll(); }, 'Parcelas futuras excluídas');
    return;
  }
  if (target.dataset.editTx) return openTransaction(txCache.find(item => item.id === target.dataset.editTx));
  if (target.dataset.editPosition) return openPosition(positionsCache.find(item => item.id === target.dataset.editPosition));
  if (target.dataset.editRec) return openRecurring(recurringCache.find(item => item.id === target.dataset.editRec));
  if (target.dataset.editSch) return openScheduled(scheduledCache.find(item => item.id === target.dataset.editSch));
  if (target.dataset.deleteTx && confirm('Excluir este lançamento?')) {
    const transactionId = target.dataset.deleteTx;
    const transaction = txCache.find(item => item.id === transactionId);
    await runAction(target, async () => {
      if (isWithdrawal(transaction)) {
        await updateDoc(userDoc('transactions', transactionId), { archived:true, walletId:null, cardId:null });
      } else {
        await deleteDoc(userDoc('transactions', transactionId));
      }
      await loadAll();
    }, 'Lançamento excluído');
  }
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
    annual.push([monthLabel(date), m.income, m.consumption, monthlySpendingGoal(m.income), m.grossContribution, m.withdrawal, m.contribution, m.balance, m.contributionRate ?? 0]);
  }
  const positions = calcPositions();
  const positionRows = positionsCache.map(p => [p.type, p.name, safeNumber(p.value), p.debtKind ? debtKindLabel(p.debtKind) : '', p.institution || '', safeNumber(p.originalAmount), safeNumber(p.installmentAmount), p.totalInstallments || '', p.paidInstallments || '', safeNumber(p.interestRate), p.dueDay || '', p.notes || '']);
  positionRows.push(['asset','Patrimônio por aportes (automático)', positions.contributionAssets,'','','','','','','','','']);
  const walletRows = walletMetrics(walletsCache, cardsCache, txCache, ymd(new Date())).byWallet.map(w => [w.institution,w.name,walletTypeLabel(w.type),safeNumber(w.initialBalance),safeNumber(w.balance),w.active === false ? 'Arquivada' : 'Ativa']);
  const cardRows = cardDebtMetrics(cardsCache, txCache, scheduledCache, ymd(new Date())).byCard.map(c => [c.institution,c.name,safeNumber(c.creditLimit),safeNumber(c.open),safeNumber(c.nextInvoice),safeNumber(c.availableLimit),c.closingDay,c.dueDay,walletById(c.paymentWalletId)?.name || '',c.active === false ? 'Arquivado' : 'Ativo']);
  const goalRows = monthlyGoalsCache.map(g => {
    const key = g.month || g.id;
    const date = dateFromMonthKey(key);
    const metrics = date ? monthMetrics(txCache, date, recurringCache) : { income: 0 };
    return [key, safeNumber(g.monthlySurplusGoal), metrics.income, monthlySpendingGoal(metrics.income)];
  });
  const sheets = [
    sheetXml('Resumo',['Indicador','Valor'],[
      ['Ativos totais', positions.assets],
      ['Reserva cadastrada', positions.manualReserve],
      ['Patrimônio por aportes', positions.contributionAssets],
      ['Saldo em carteiras', positions.walletAssets],
      ['Dívidas manuais', positions.manualDebts],
      ['Cartões em aberto', positions.cardDebts],
      ['Reserva total (cadastrada + aportes)', positions.reserve],
      ['Dívidas', positions.debts],
      ['Patrimônio líquido', positions.netWorth]
    ]),
    sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem','Carteira','Cartão','Parcela'],txCache.filter(tx => !isArchivedTransaction(tx)).map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual',walletById(tx.walletId)?.name || '',cardById(tx.cardId)?.name || '',tx.installmentTotal ? `${tx.installmentNumber}/${tx.installmentTotal}` : ''])),
    sheetXml('Carteiras',['Instituição','Nome','Tipo','Saldo inicial','Saldo atual','Status'],walletRows),
    sheetXml('Cartões',['Instituição','Nome','Limite','Em aberto','Próxima fatura','Limite disponível','Fechamento','Vencimento','Carteira pagadora','Status'],cardRows),
    sheetXml('Patrimônio',['Tipo','Nome','Valor atual','Composição','Instituição','Valor original','Parcela','Total parcelas','Pagas','Juros a.a.','Vencimento','Observações'],positionRows),
    sheetXml('Recorrentes',['Nome','Tipo','Categoria','Valor','Dia','Início','Fim','Ativa'],recurringCache.map(r => [r.name,r.type,r.category,safeNumber(r.amount),r.dayOfMonth,r.startDate,r.endDate || '',r.active ? 'Sim' : 'Não'])),
    sheetXml('Agendadas',['Nome','Tipo','Categoria','Valor','Vencimento','Frequência','Status'],scheduledCache.map(s => [s.name,s.type,s.category,safeNumber(s.amount),s.dueDate,s.frequency,s.status])),
    sheetXml('Metas mensais',['Mês','Meta de aporte','Renda do mês','Meta de gasto mensal (60%)'],goalRows),
    sheetXml(`Ano ${selectedYear}`,['Mês','Receitas','Gastos','Meta gasto 60%','Aportes brutos','Resgates','Aporte líquido','Saldo','Taxa de aporte (%)'],annual)
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
window.addEventListener('focus', () => void synchronizeDateRollover());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void synchronizeDateRollover(); });
setInterval(() => void synchronizeDateRollover(), 60_000);
onAuthStateChanged(auth, async current => {
  user = current;
  if (current) {
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    try { await loadAll(); }
    catch (error) { console.error(error); toast('Falha ao carregar os dados. Atualize a página.'); }
  } else {
    txCache = []; positionsCache = []; recurringCache = []; scheduledCache = []; walletsCache = []; cardsCache = []; monthlyGoalsCache = []; settings = {};
    $('#authView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker indisponível.', error));
}
