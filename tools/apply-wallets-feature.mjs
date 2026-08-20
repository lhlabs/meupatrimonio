import fs from 'node:fs';

function patch(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Nenhuma alteração aplicada em ${path}`);
  fs.writeFileSync(path, after);
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: esperado 1 ponto de alteração, encontrado ${count}`);
  return text.replace(from, to);
}

function replaceRegex(text, regex, to, label) {
  const matches = text.match(regex);
  if (!matches) throw new Error(`${label}: padrão não encontrado`);
  return text.replace(regex, to);
}

patch('supabase/migrations/20260820143000_wallets_cards_debt_composition.sql', text => {
  text = text.replace(/\n  add constraint transactions_route_exclusive[^;]+;/, '');
  text = text.replace(/\n  add constraint recurring_route_exclusive[^;]+;/, '');
  text = text.replace(/\n  add constraint scheduled_route_exclusive[^;]+;/, '');
  text = text.replace(
    `  add constraint transactions_card_expense_only check ("cardId" is null or type = 'expense'),`,
    `  add constraint transactions_card_expense_only check ("cardId" is null or type = 'expense'),\n  add constraint transactions_card_requires_wallet check ("cardId" is null or "walletId" is not null),`
  );
  text = text.replace(
    `  add constraint recurring_card_expense_only check ("cardId" is null or type = 'expense');`,
    `  add constraint recurring_card_expense_only check ("cardId" is null or type = 'expense'),\n  add constraint recurring_card_requires_wallet check ("cardId" is null or "walletId" is not null);`
  );
  text = text.replace(
    `  add constraint scheduled_card_expense_only check ("cardId" is null or type = 'expense'),`,
    `  add constraint scheduled_card_expense_only check ("cardId" is null or type = 'expense'),\n  add constraint scheduled_card_requires_wallet check ("cardId" is null or "walletId" is not null),`
  );
  return text;
});

patch('compat/firebase-firestore.js', text => replaceOnce(
  text,
  `['transactions','positions','monthlyGoals','recurring','scheduled']`,
  `['transactions','positions','monthlyGoals','recurring','scheduled','wallets','cards']`,
  'compat collections'
));

patch('finance-logic.js', text => {
  const replacement = `export function splitInstallmentAmounts(amount, installments) {
  const count = Math.max(1, Math.min(120, Math.trunc(safeNumber(installments) || 1)));
  const cents = Math.round(Math.max(0, safeNumber(amount)) * 100);
  if (cents < count) return [];
  const base = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export function cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay, dueDay }) {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(purchaseDate || ''));
  if (!match) return [];
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const purchase = new Date(year, month - 1, day, 12);
  if (purchase.getFullYear() !== year || purchase.getMonth() !== month - 1 || purchase.getDate() !== day) return [];
  const close = Math.max(1, Math.min(31, Math.trunc(safeNumber(closingDay) || 1)));
  const due = Math.max(1, Math.min(31, Math.trunc(safeNumber(dueDay) || 1)));
  const amounts = splitInstallmentAmounts(amount, installments);
  if (!amounts.length) return [];
  const closingDate = dueDateFor(year, month - 1, close);
  const statementMonth = new Date(year, month - 1 + (String(purchaseDate) > closingDate ? 1 : 0), 1, 12);
  const firstDueMonth = new Date(statementMonth);
  if (due <= close) firstDueMonth.setMonth(firstDueMonth.getMonth() + 1);
  return amounts.map((installmentAmount, index) => {
    const cursor = new Date(firstDueMonth.getFullYear(), firstDueMonth.getMonth() + index, 1, 12);
    return {
      amount: installmentAmount,
      date: dueDateFor(cursor.getFullYear(), cursor.getMonth(), due),
      installmentNumber: index + 1,
      installmentTotal: amounts.length
    };
  });
}

export function walletMetrics(wallets = [], cards = [], transactions = [], throughDate = ymd(new Date())) {
  void cards;
  const byWallet = wallets.map(wallet => {
    const movements = transactions.filter(item => item?.walletId === wallet.id && (!throughDate || String(item.date || '') <= throughDate));
    const movementBalance = movements.reduce((sum, item) => {
      const amount = safeNumber(item.amount);
      return sum + (item.type === 'income' ? amount : item.type === 'expense' ? -amount : 0);
    }, 0);
    return { ...wallet, balance: safeNumber(wallet.initialBalance) + movementBalance };
  });
  return {
    byWallet,
    total: byWallet.reduce((sum, item) => sum + safeNumber(item.balance), 0)
  };
}

export function cardDebtMetrics(cards = [], transactions = [], scheduled = [], throughDate = ymd(new Date())) {
  void transactions;
  const byCard = cards.map(card => {
    const pending = scheduled
      .filter(item => item?.status === 'active' && item.cardId === card.id)
      .filter(item => !item.purchaseDate || !throughDate || String(item.purchaseDate) <= throughDate)
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    const open = pending.reduce((sum, item) => sum + safeNumber(item.amount), 0);
    const nextDue = pending[0]?.dueDate || '';
    const nextMonth = String(nextDue).slice(0, 7);
    const nextInvoice = nextMonth
      ? pending.filter(item => String(item.dueDate || '').startsWith(nextMonth)).reduce((sum, item) => sum + safeNumber(item.amount), 0)
      : 0;
    return {
      ...card,
      open,
      nextDue,
      nextInvoice,
      availableLimit: Math.max(0, safeNumber(card.creditLimit) - open)
    };
  });
  return { byCard, total: byCard.reduce((sum, item) => sum + safeNumber(item.open), 0) };
}

export function positionMetrics(positions = [], transactions = [], throughDate = ymd(new Date()), wallets = [], cards = [], scheduled = []) {
  const manualAssets = positions
    .filter(item => ['asset', 'reserve'].includes(item?.type))
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const manualReserve = positions
    .filter(item => item?.type === 'reserve')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const manualDebts = positions
    .filter(item => item?.type === 'debt')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const contributionAssets = contributionBalance(transactions, throughDate);
  const walletAssets = walletMetrics(wallets, cards, transactions, throughDate).total;
  const cardDebts = cardDebtMetrics(cards, transactions, scheduled, throughDate).total;
  const assets = manualAssets + contributionAssets + walletAssets;
  const reserve = manualReserve + contributionAssets;
  const debts = manualDebts + cardDebts;
  return {
    manualAssets,
    manualReserve,
    manualDebts,
    contributionAssets,
    walletAssets,
    cardDebts,
    assets,
    reserve,
    debts,
    netWorth: assets - debts
  };
}

export function recurringDue`;
  return replaceRegex(
    text,
    /export function positionMetrics\([\s\S]*?\n}\n\nexport function recurringDue/,
    replacement,
    'finance wallet metrics'
  );
});

patch('app.js', text => {
  text = replaceOnce(
    text,
    `CONTRIBUTION_CATEGORY, WITHDRAWAL_CATEGORY, addYear, clamp, contributionBalance,\n  isContribution, isWithdrawal, monthKey, monthMetrics, monthlySpendingGoal,\n  nextRecurringDue, periodSpendingMetrics, positionMetrics, projectFutureValue,\n  recurringDue, reserveMetrics, safeNumber, scoreMetrics, shouldMaterializeRecurring, ymd`,
    `CONTRIBUTION_CATEGORY, WITHDRAWAL_CATEGORY, addYear, cardDebtMetrics, cardInstallmentSchedule, clamp, contributionBalance,\n  isContribution, isWithdrawal, monthKey, monthMetrics, monthlySpendingGoal,\n  nextRecurringDue, periodSpendingMetrics, positionMetrics, projectFutureValue,\n  recurringDue, reserveMetrics, safeNumber, scoreMetrics, shouldMaterializeRecurring, walletMetrics, ymd`,
    'app imports'
  );

  text = replaceOnce(
    text,
    `let scheduledCache = [];\nlet monthlyGoalsCache = [];`,
    `let scheduledCache = [];\nlet walletsCache = [];\nlet cardsCache = [];\nlet monthlyGoalsCache = [];`,
    'account caches'
  );

  text = replaceOnce(
    text,
    `function calcPositions() { return positionMetrics(positionsCache, txCache, ymd(new Date())); }`,
    `function calcPositions() { return positionMetrics(positionsCache, txCache, ymd(new Date()), walletsCache, cardsCache, scheduledCache); }\nfunction walletById(id) { return walletsCache.find(item => item.id === id) || null; }\nfunction cardById(id) { return cardsCache.find(item => item.id === id) || null; }\nfunction newEntityId(prefix = 'id') { return \`${'${prefix}'}_${'${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}'}\`.replace(/[^A-Za-z0-9_-]/g, '_'); }\nfunction installmentPlansForMonth(date) { return plannedForMonth(date).filter(item => item.installmentGroupId); }\nfunction transactionsWithInstallmentPlans(date) { return [...txCache, ...installmentPlansForMonth(date)]; }\nfunction metricsForMonth(date) { return monthMetrics(transactionsWithInstallmentPlans(date), date, recurringCache); }\nfunction spendingForMonth(date) { return periodSpendingMetrics(transactionsWithInstallmentPlans(date), recurringCache, date); }`,
    'position metrics integration'
  );

  text = replaceOnce(
    text,
    `  installAnnualToggle();\n  ensureWithdrawalDialog();`,
    `  installAnnualToggle();\n  ensureWithdrawalDialog();\n  installAccountUi();\n  installTransactionRoutingUi();\n  installDebtFieldsUi();`,
    'prepare account ui'
  );

  const accountUi = `
function walletTypeLabel(type) {
  return ({ checking:'Conta corrente', savings:'Poupança', cash:'Dinheiro', digital:'Conta digital', other:'Outra' })[type] || 'Carteira';
}

function debtKindLabel(type) {
  return ({ vehicle_financing:'Financiamento veicular', mortgage:'Financiamento habitacional', installment:'Compra parcelada', personal_loan:'Empréstimo pessoal', student_loan:'Financiamento estudantil', other:'Outra dívida' })[type] || 'Dívida';
}

function accountOptions(rows, selected = '', emptyLabel = 'Selecione') {
  const active = rows.filter(item => item.active !== false || item.id === selected);
  return \`<option value="">${'${emptyLabel}'}</option>\${active.map(item => \`<option value="\${esc(item.id)}" \${item.id === selected ? 'selected' : ''}>\${esc(item.institution)} · \${esc(item.name)}</option>\`).join('')}\`;
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
  panel.innerHTML = \`
    <div class="panel-head account-head"><div><span class="card-kicker">CARTEIRAS</span><h2>Onde seu dinheiro está</h2><p class="muted">O saldo é calculado pelo saldo inicial + movimentações. Cartões baixam a carteira pagadora somente no vencimento.</p></div><div class="button-row"><button id="openWalletBtn" class="ghost-btn" type="button">+ Carteira</button><button id="openCardBtn" class="primary compact" type="button">+ Cartão</button></div></div>
    <div class="account-summary"><div><span>Saldo em carteiras</span><strong id="walletsTotal">R$ 0</strong></div><div><span>Cartões em aberto</span><strong id="cardsOpenTotal">R$ 0</strong></div><div><span>Disponível líquido</span><strong id="accountsLiquid">R$ 0</strong></div></div>
    <div class="account-section-title"><strong>Instituições e contas</strong><small id="walletCount" class="muted"></small></div><div id="walletCards" class="account-grid"></div>
    <div class="account-section-title"><strong>Cartões de crédito</strong><small id="cardCount" class="muted"></small></div><div id="creditCardCards" class="account-grid"></div>
    <div class="account-section-title"><strong>Compras parceladas</strong><small class="muted">parcelas futuras</small></div><div id="installmentGroups" class="installment-list"></div>\`;
  anchor.parentNode.insertBefore(panel, anchor);

  const walletDialog = document.createElement('dialog');
  walletDialog.id = 'walletDialog';
  walletDialog.innerHTML = \`<form id="walletForm" method="dialog" class="sheet-form"><input id="walletEditId" type="hidden"><div class="dialog-head"><div><span class="card-kicker">CARTEIRA</span><h2 id="walletDialogTitle">Nova carteira</h2></div><button type="button" class="icon-btn" data-close-account-dialog>×</button></div><label>Instituição<input id="walletInstitution" maxlength="60" required placeholder="Ex.: Nubank, Sicredi, Caixa"></label><label>Nome da conta<input id="walletName" maxlength="60" required placeholder="Ex.: Conta principal"></label><label>Tipo<select id="walletType"><option value="checking">Conta corrente</option><option value="digital">Conta digital</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="other">Outra</option></select></label><label>Saldo inicial no app<input id="walletInitialBalance" type="number" step="0.01" required value="0"></label><p class="muted account-help">Use o saldo existente no momento em que começar a movimentar esta carteira no Meu Patrimônio. O saldo atual não é armazenado: ele é recalculado pelas movimentações.</p><button class="primary" type="submit">Salvar carteira</button></form>\`;
  document.body.appendChild(walletDialog);

  const cardDialog = document.createElement('dialog');
  cardDialog.id = 'cardDialog';
  cardDialog.innerHTML = \`<form id="cardForm" method="dialog" class="sheet-form"><input id="cardEditId" type="hidden"><div class="dialog-head"><div><span class="card-kicker">CARTÃO</span><h2 id="cardDialogTitle">Novo cartão</h2></div><button type="button" class="icon-btn" data-close-account-dialog>×</button></div><label>Instituição<input id="cardInstitution" maxlength="60" required placeholder="Ex.: Nubank"></label><label>Nome do cartão<input id="cardName" maxlength="60" required placeholder="Ex.: Mastercard Black"></label><label>Limite<input id="cardLimit" type="number" min="0" step="0.01" required></label><div class="form-grid two"><label>Fechamento<input id="cardClosingDay" type="number" min="1" max="31" required></label><label>Vencimento<input id="cardDueDay" type="number" min="1" max="31" required></label></div><label>Carteira que paga a fatura<select id="cardPaymentWalletId" required></select></label><p class="muted account-help">O cartão não cria um segundo saldo. Cada parcela reduz esta carteira no vencimento e permanece como dívida de cartão até lá.</p><button class="primary" type="submit">Salvar cartão</button></form>\`;
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
  $('#accountsLiquid').textContent = currency.format(wallets.total - cards.total);
  $('#walletCount').textContent = \`${'${walletsCache.filter(item => item.active !== false).length}'} ativas\`;
  $('#cardCount').textContent = \`${'${cardsCache.filter(item => item.active !== false).length}'} ativos\`;
  $('#walletCards').innerHTML = wallets.byWallet.map(item => \`<div class="account-card \${item.active === false ? 'inactive' : ''}"><div class="account-card-top"><div class="account-logo">🏦</div><div><strong>\${esc(item.name)}</strong><small>\${esc(item.institution)} · \${walletTypeLabel(item.type)}</small></div></div><div class="account-balance"><span>Saldo atual</span><strong class="\${item.balance < 0 ? 'expense' : ''}">\${currency.format(item.balance)}</strong></div><div class="row-actions"><button class="mini-btn" data-edit-wallet="\${item.id}">Editar</button><button class="mini-btn" data-toggle-wallet="\${item.id}">\${item.active === false ? 'Reativar' : 'Arquivar'}</button></div></div>\`).join('') || '<div class="empty-state">Cadastre sua primeira instituição e conta.</div>';
  $('#creditCardCards').innerHTML = cards.byCard.map(item => \`<div class="account-card card-account \${item.active === false ? 'inactive' : ''}"><div class="account-card-top"><div class="account-logo">💳</div><div><strong>\${esc(item.name)}</strong><small>\${esc(item.institution)} · fecha dia \${item.closingDay} · vence dia \${item.dueDay}</small></div></div><div class="card-stats"><div><span>Em aberto</span><strong>\${currency.format(item.open)}</strong></div><div><span>Próxima fatura</span><strong>\${currency.format(item.nextInvoice)}</strong></div><div><span>Limite disponível</span><strong>\${currency.format(item.availableLimit)}</strong></div></div><small class="muted">Pagamento: \${esc(walletById(item.paymentWalletId)?.name || 'Carteira não localizada')}\${item.nextDue ? ` · próximo vencimento ${'${formatDate(item.nextDue)}'}` : ''}</small><div class="row-actions"><button class="mini-btn" data-edit-card="\${item.id}">Editar</button><button class="mini-btn" data-toggle-card="\${item.id}">\${item.active === false ? 'Reativar' : 'Arquivar'}</button></div></div>\`).join('') || '<div class="empty-state">Nenhum cartão cadastrado.</div>';

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
    return \`<div class="installment-row"><div><strong>\${esc(group.description || 'Compra parcelada')}</strong><small>\${esc(card?.name || 'Cartão')} · \${paid}/\${group.total} pagas · próxima \${formatDate(active[0]?.dueDate)}</small></div><div><strong>\${currency.format(remaining)}</strong><small>saldo parcelado</small></div><button class="mini-btn danger" data-delete-installment-group="\${esc(group.id)}">Excluir futuras</button></div>\`;
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
  box.innerHTML = \`<label>Movimentar em<select id="transactionRoute"><option value="wallet">Carteira / conta</option><option value="card">Cartão de crédito</option><option value="none">Sem carteira (legado)</option></select></label><label id="transactionWalletLabel">Carteira<select id="transactionWalletId"></select></label><label id="transactionCardLabel" class="hidden">Cartão<select id="transactionCardId"></select></label><label id="transactionInstallmentsLabel" class="hidden">Parcelas<select id="transactionInstallments">\${Array.from({length:60},(_,i)=>`<option value="${'${i+1}'}">${'${i+1}'}x</option>`).join('')}</select></label><small id="transactionRouteHint" class="muted routing-hint"></small>\`;
  form.insertBefore(box, recurringLabel);
  $('#transactionRoute').addEventListener('change', syncTransactionRouting);
  $('#transactionCardId').addEventListener('change', syncTransactionRouting);

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

function syncTransactionRouting() {
  if (!$('#transactionRoute')) return;
  const type = $('#transactionType')?.value || 'expense';
  let route = $('#transactionRoute').value;
  if (type === 'income' && route === 'card') { route = walletsCache.some(item => item.active !== false) ? 'wallet' : 'none'; $('#transactionRoute').value = route; }
  const cardMode = route === 'card' && type === 'expense';
  $('#transactionWalletLabel')?.classList.toggle('hidden', route !== 'wallet');
  $('#transactionCardLabel')?.classList.toggle('hidden', !cardMode);
  $('#transactionInstallmentsLabel')?.classList.toggle('hidden', !cardMode);
  const recurring = $('#transactionRecurring');
  if (recurring) {
    if (cardMode) recurring.checked = false;
    recurring.disabled = !!$('#transactionEditId')?.value || cardMode;
  }
  const dateLabel = $('#transactionDate')?.closest('label');
  if (dateLabel?.childNodes[0]) dateLabel.childNodes[0].textContent = cardMode ? 'Data da compra' : 'Data';
  const hint = $('#transactionRouteHint');
  if (hint) hint.textContent = cardMode ? 'O valor informado é o total da compra. As parcelas entram nos meses de vencimento da fatura e a carteira pagadora é movimentada automaticamente.' : route === 'wallet' ? 'Esta movimentação altera o saldo da carteira escolhida.' : 'Lançamentos sem carteira ficam fora dos saldos por instituição.';
}

function installDebtFieldsUi() {
  if ($('#positionDebtFields')) return;
  const form = $('#positionForm');
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !submit) return;
  const box = document.createElement('div');
  box.id = 'positionDebtFields';
  box.className = 'debt-fields hidden';
  box.innerHTML = \`<span class="card-kicker">COMPOSIÇÃO DA DÍVIDA</span><label>Tipo da dívida<select id="debtKind"><option value="vehicle_financing">Financiamento veicular</option><option value="mortgage">Financiamento habitacional</option><option value="installment">Parcelado</option><option value="personal_loan">Empréstimo pessoal</option><option value="student_loan">Financiamento estudantil</option><option value="other">Outra</option></select></label><label>Instituição / credor<input id="debtInstitution" maxlength="60"></label><div class="form-grid two"><label>Valor original<input id="debtOriginalAmount" type="number" min="0" step="0.01"></label><label>Valor da parcela<input id="debtInstallmentAmount" type="number" min="0" step="0.01"></label><label>Total de parcelas<input id="debtTotalInstallments" type="number" min="1" max="1200"></label><label>Parcelas pagas<input id="debtPaidInstallments" type="number" min="0" max="1200"></label><label>Juros (% a.a.)<input id="debtInterestRate" type="number" min="0" max="100" step="0.01"></label><label>Dia do vencimento<input id="debtDueDay" type="number" min="1" max="31"></label></div><label>Observações<input id="debtNotes" maxlength="240"></label>\`;
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
`;
  text = replaceOnce(text, `function installTransactionPeriodFilter() {`, accountUi + `\nfunction installTransactionPeriodFilter() {`, 'account ui helpers');

  text = replaceRegex(text, /async function loadAll\(\) \{[\s\S]*?\n}\n\nfunction renderAll\(\)/, `async function loadAll() {
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

function renderAll()`, 'load all accounts');

  text = replaceOnce(text, `  renderPositions();\n  renderPlanning();`, `  renderPositions();\n  renderAccounts();\n  renderPlanning();`, 'render accounts');
  text = replaceOnce(text, `const metrics = monthMetrics(txCache, selectedMonth, recurringCache);`, `const metrics = metricsForMonth(selectedMonth);`, 'dashboard planned installment metrics');
  text = replaceOnce(text, `const prev = monthMetrics(txCache, prevDate, recurringCache);`, `const prev = metricsForMonth(prevDate);`, 'dashboard prior metrics');
  text = replaceOnce(text, `const spending = periodSpendingMetrics(txCache, recurringCache, selectedMonth);`, `const spending = spendingForMonth(selectedMonth);`, 'dashboard spending');
  text = text.replace(`const previous = monthMetrics(txCache, prev, recurringCache);`, `const previous = metricsForMonth(prev);`);
  text = text.replace(`const metrics = date ? monthMetrics(txCache, date, recurringCache) : null;`, `const metrics = date ? metricsForMonth(date) : null;`);
  text = text.replace(`if (!dateFrom && !dateTo) list = monthMetrics(txCache, selectedMonth, recurringCache).rows.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));`, `if (!dateFrom && !dateTo) list = metricsForMonth(selectedMonth).rows.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));`);
  text = text.replace(`const m = monthMetrics(txCache, d, recurringCache);`, `const m = metricsForMonth(d);`);

  text = replaceRegex(text, /function txRow\(tx\) \{[\s\S]*?\n}\n\nfunction renderTransactions/, `function txRow(tx) {
  const wallet = walletById(tx.walletId);
  const card = cardById(tx.cardId);
  const installment = tx.installmentTotal ? \` · \${tx.installmentNumber}/\${tx.installmentTotal}\` : '';
  const account = card ? \` · \${esc(card.name)}\` : wallet ? \` · \${esc(wallet.name)}\` : '';
  const source = tx.sourceType === 'recurring' ? (tx.projected ? ' · recorrente prevista' : ' · recorrente') : tx.sourceType === 'scheduled' ? (tx.projected ? ' · prevista' : ' · agendada') : '';
  let actions = '';
  if (tx.projected) actions = '<span class="muted">Previsto</span>';
  else if (tx.installmentGroupId) actions = '<span class="muted">Parcela</span>';
  else if (isWithdrawal(tx)) actions = \`<button class="mini-btn danger" data-delete-tx="\${tx.id}">Excluir</button>\`;
  else if (tx.sourceType === 'scheduled') actions = \`<button class="mini-btn" data-edit-tx="\${tx.id}">Editar</button><span class="muted">Agendado</span>\`;
  else if (tx.sourceType) actions = '<span class="muted">Automático</span>';
  else actions = \`<button class="mini-btn" data-edit-tx="\${tx.id}">Editar</button><button class="mini-btn danger" data-delete-tx="\${tx.id}">Excluir</button>\`;
  return \`<div class="list-row"><div class="list-icon">\${tx.type === 'expense' ? '−' : '+'}</div><div class="list-main"><strong>\${esc(tx.description || tx.category)}</strong><small>\${esc(tx.category)} · \${formatDate(tx.date)}\${source}\${installment}\${account}\${isContribution(tx) ? ' · aporte' : ''}\${isWithdrawal(tx) ? ' · resgate patrimonial' : ''}</small></div><div><div class="money \${tx.type}">\${tx.type === 'expense' ? '−' : '+'}\${currency.format(safeNumber(tx.amount))}</div><div class="row-actions">\${actions}</div></div></div>\`;
}

function renderTransactions`, 'transaction row labels');

  text = replaceOnce(
    text,
    `if (!exists) out.push({ name: scheduled.name, amount: safeNumber(scheduled.amount), type: scheduled.type, date: due, category: scheduled.category, icon:'📅', sourceType:'scheduled', sourceId:scheduled.id });`,
    `if (!exists) out.push({ id:scheduledTransactionId(scheduled, due), name: scheduled.name, description:scheduled.description || scheduled.name, amount: safeNumber(scheduled.amount), type: scheduled.type, date: due, category: scheduled.category, icon:scheduled.installmentGroupId ? '💳' : '📅', sourceType:'scheduled', sourceId:scheduled.id, walletId:scheduled.walletId || null, cardId:scheduled.cardId || null, purchaseDate:scheduled.purchaseDate || null, installmentGroupId:scheduled.installmentGroupId || null, installmentNumber:scheduled.installmentNumber || null, installmentTotal:scheduled.installmentTotal || null, projected:true });`,
    'planned scheduled metadata'
  );

  text = replaceRegex(text, /function renderAgenda\(\) \{[\s\S]*?\n}\n\nfunction renderPositions/, `function renderAgenda() {
  if (!agendaAvailable) {
    $('#automationNotice').classList.remove('hidden');
    $('#automationNotice').textContent = 'As regras atuais não liberaram a agenda.';
    $('#recurringList').innerHTML = $('#scheduledList').innerHTML = '<div class="empty-state">Agenda indisponível.</div>';
    return;
  }
  $('#automationNotice').classList.add('hidden');
  const regularScheduled = scheduledCache.filter(item => !item.installmentGroupId);
  const installmentGroups = new Set(scheduledCache.filter(item => item.status === 'active' && item.installmentGroupId).map(item => item.installmentGroupId));
  $('#recurringCount').textContent = \`${recurringCache.filter(item => item.active).length} ativas\`;
  $('#scheduledCount').textContent = \`${regularScheduled.filter(item => item.status === 'active').length} futuras${installmentGroups.size ? ` · ${installmentGroups.size} parceladas` : ''}\`;
  $('#recurringList').innerHTML = recurringCache.map(item => \`<div class="agenda-item \${item.active ? '' : 'inactive'}"><div class="agenda-icon">🔁</div><div><strong>\${esc(item.name)}</strong><small>\${currency.format(safeNumber(item.amount))} · dia \${item.dayOfMonth} · \${esc(item.category)}\${walletById(item.walletId) ? ` · ${esc(walletById(item.walletId).name)}` : ''}</small></div><div class="agenda-actions"><button class="mini-btn" data-edit-rec="\${item.id}">Editar</button><button class="mini-btn danger" data-del-rec="\${item.id}">Excluir</button></div></div>\`).join('') || '<div class="empty-state">Nenhuma recorrência.</div>';
  $('#scheduledList').innerHTML = regularScheduled.map(item => {
    const postedTx = item.status === 'posted' ? latestScheduledTransaction(item.id) : null;
    const editAction = item.status === 'active' ? \`<button class="mini-btn" data-edit-sch="\${item.id}">Editar</button>\` : postedTx ? \`<button class="mini-btn" data-edit-tx="\${postedTx.id}">Editar lançamento</button>\` : '';
    return \`<div class="agenda-item \${item.status === 'active' ? '' : 'inactive'}"><div class="agenda-icon">📅</div><div><strong>\${esc(item.name)}</strong><small>\${currency.format(safeNumber(item.amount))} · \${formatDate(item.dueDate)} · \${item.frequency === 'annual' ? 'anual' : item.status === 'posted' ? 'lançada' : 'uma vez'}\${walletById(item.walletId) ? ` · ${esc(walletById(item.walletId).name)}` : ''}</small></div><div class="agenda-actions">\${editAction}<button class="mini-btn danger" data-del-sch="\${item.id}">Excluir</button></div></div>\`;
  }).join('') || '<div class="empty-state">Nenhuma conta agendada. Parcelamentos ficam em Carteiras.</div>';
}

function renderPositions`, 'agenda installment grouping');

  text = replaceRegex(text, /function renderPositions\(\) \{[\s\S]*?\n}\n\nfunction renderPlanning/, `function renderPositions() {
  const positions = calcPositions();
  $('#assetsTotal').textContent = currency.format(positions.assets);
  $('#debtsTotal').textContent = currency.format(positions.debts);
  $('#patrimonyNetWorth').textContent = currency.format(positions.netWorth);

  const hasContributionHistory = txCache.some(isContribution) || txCache.some(isWithdrawal);
  const autoRow = hasContributionHistory
    ? \`<div class="list-row"><div class="list-icon">↗</div><div class="list-main"><strong>Patrimônio por aportes</strong><small>Automático · integra a reserva de emergência · aportes realizados menos resgates</small></div><div><div class="money income">\${currency.format(positions.contributionAssets)}</div><div class="row-actions"><button class="mini-btn" type="button" data-withdraw-contribution \${positions.contributionAssets > 0 ? '' : 'disabled'}>Mover para saldo</button></div></div></div>\`
    : '';
  const manualRows = positionsCache.map(item => {
    const debt = item.type === 'debt';
    const parts = [];
    if (debt && item.debtKind) parts.push(debtKindLabel(item.debtKind));
    if (debt && item.institution) parts.push(esc(item.institution));
    if (debt && item.totalInstallments) parts.push(\`${safeNumber(item.paidInstallments)} de \${safeNumber(item.totalInstallments)} parcelas pagas\`);
    if (debt && safeNumber(item.installmentAmount) > 0) parts.push(\`parcela \${currency.format(safeNumber(item.installmentAmount))}\`);
    if (debt && safeNumber(item.dueDay) > 0) parts.push(\`vence dia \${safeNumber(item.dueDay)}\`);
    const detail = debt ? (parts.join(' · ') || 'Dívida') : item.type === 'reserve' ? 'Reserva' : 'Ativo';
    const progress = debt && item.totalInstallments ? clamp(safeNumber(item.paidInstallments) / safeNumber(item.totalInstallments), 0, 1) : null;
    return \`<div class="list-row debt-row"><div class="list-icon">\${debt ? '−' : '+'}</div><div class="list-main"><strong>\${esc(item.name)}</strong><small>\${detail}</small>\${progress != null ? `<div class="debt-progress"><i style="width:${progress * 100}%"></i></div>` : ''}</div><div><div class="money \${debt ? 'expense' : 'income'}">\${currency.format(safeNumber(item.value))}</div><div class="row-actions"><button class="mini-btn" data-edit-position="\${item.id}">Editar</button><button class="mini-btn danger" data-delete-position="\${item.id}">Excluir</button></div></div></div>\`;
  }).join('');
  $('#positionsList').innerHTML = autoRow + manualRows || '<div class="empty-state">Nenhuma posição.</div>';
  $('#positionsList').classList.toggle('empty-state', !(autoRow || manualRows));
}

function renderPlanning`, 'debt composition rendering');

  text = replaceRegex(text, /function openTransaction\(tx = null\) \{[\s\S]*?\n}\n\nfunction openPosition/, `function openTransaction(tx = null) {
  if (tx?.installmentGroupId) return toast('Compras parceladas são gerenciadas em Carteiras & patrimônio.');
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

function openPosition`, 'open transaction routes');

  text = replaceRegex(text, /function openPosition\(position = null\) \{[\s\S]*?\n}\n\nfunction openRecurring/, `function openPosition(position = null) {
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

function openRecurring`, 'open debt position');

  text = text.replace(`  $('#recurringActive').checked = item ? !!item.active : true;\n  $('#recurringDialog').showModal();`, `  $('#recurringActive').checked = item ? !!item.active : true;\n  if ($('#recurringWalletId')) $('#recurringWalletId').value = item?.walletId || walletsCache.find(row => row.active !== false)?.id || '';\n  $('#recurringDialog').showModal();`);
  text = text.replace(`  $('#scheduledFrequency').value = item?.frequency || 'once';\n  $('#scheduledDialog').showModal();`, `  $('#scheduledFrequency').value = item?.frequency || 'once';\n  if ($('#scheduledWalletId')) $('#scheduledWalletId').value = item?.walletId || walletsCache.find(row => row.active !== false)?.id || '';\n  $('#scheduledDialog').showModal();`);

  text = replaceOnce(text, `  $$('[data-tx-type]').forEach(button => button.classList.toggle('selected', button.dataset.txType === type));\n}`, `  $$('[data-tx-type]').forEach(button => button.classList.toggle('selected', button.dataset.txType === type));\n  syncTransactionRouting();\n}`, 'sync route on tx type');

  text = replaceRegex(text, /\$\('#transactionForm'\)\.addEventListener\('submit',[\s\S]*?\n}\);\n\n\$\('#positionForm'/, `$('#transactionForm').addEventListener('submit', async event => {
  event.preventDefault();
  await runAction(event.submitter, async () => {
    const id = $('#transactionEditId').value;
    const amount = safeNumber($('#transactionAmount').value);
    const type = $('#transactionType').value;
    const category = $('#transactionCategory').value;
    const description = $('#transactionDescription').value.trim();
    const date = $('#transactionDate').value;
    const route = $('#transactionRoute')?.value || 'none';
    if (!(amount > 0) || !['income','expense'].includes(type) || !category || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('Lançamento inválido');
    if (id) {
      const walletId = route === 'wallet' ? $('#transactionWalletId').value || null : null;
      if (walletsCache.some(item => item.active !== false) && route === 'wallet' && !walletId) throw new Error('Selecione a carteira');
      await updateDoc(userDoc('transactions', id), { type, amount, category, description, date, walletId, cardId:null });
    } else if (route === 'card') {
      if (type !== 'expense') throw new Error('Cartão aceita apenas despesas');
      const card = cardById($('#transactionCardId').value);
      const installments = Math.trunc(safeNumber($('#transactionInstallments').value || 1));
      if (!card || card.active === false || installments < 1 || installments > 60) throw new Error('Cartão ou parcelamento inválido');
      const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate:date, closingDay:card.closingDay, dueDay:card.dueDay });
      if (schedule.length !== installments) throw new Error('O valor é baixo demais para a quantidade de parcelas');
      const groupId = newEntityId('grp');
      for (const part of schedule) {
        const scheduledId = \`inst_\${groupId}_\${String(part.installmentNumber).padStart(3,'0')}\`;
        await setDoc(userDoc('scheduled', scheduledId), {
          name: \`${description || category} · \${part.installmentNumber}/\${part.installmentTotal}\`,
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
        await setDoc(userDoc('recurring', \`legacy_\${ref.id}\`), {
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

$('#positionForm'`, 'transaction submit wallet/card');

  text = replaceRegex(text, /\$\('#positionForm'\)\.addEventListener\('submit',[\s\S]*?\n}\);\n\n\$\('#planningForm'/, `$('#positionForm').addEventListener('submit', async event => {
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

$('#planningForm'`, 'position debt submit');

  text = text.replace(
    `const data = { name, type, amount, category, description: name, dayOfMonth, startDate, endDate, active, updatedAt: serverTimestamp() };`,
    `const walletId = $('#recurringWalletId')?.value || null;\n    if (walletsCache.some(item => item.active !== false) && !walletId) throw new Error('Selecione a carteira da recorrência');\n    const data = { name, type, amount, category, description: name, dayOfMonth, startDate, endDate, active, walletId, cardId:null, updatedAt: serverTimestamp() };`
  );
  text = text.replace(
    `const data = { name, type, amount, category, description: name, dueDate, frequency, status:'active', updatedAt: serverTimestamp() };`,
    `const walletId = $('#scheduledWalletId')?.value || null;\n    if (walletsCache.some(item => item.active !== false) && !walletId) throw new Error('Selecione a carteira do compromisso');\n    const data = { name, type, amount, category, description: name, dueDate, frequency, status:'active', walletId, cardId:null, updatedAt: serverTimestamp() };`
  );

  text = text.replace(
    `type: 'income', amount, category: WITHDRAWAL_CATEGORY, description, date,\n      recurring: false, createdAt: serverTimestamp()`,
    `type: 'income', amount, category: WITHDRAWAL_CATEGORY, description, date,\n      walletId: $('#withdrawalWalletId')?.value || null, cardId:null, recurring: false, createdAt: serverTimestamp()`
  );
  text = text.replace(
    `  $('#withdrawalAvailable').textContent = \`Disponível hoje: \${currency.format(available)}\`;`,
    `  $('#withdrawalAvailable').textContent = \`Disponível hoje: \${currency.format(available)}\`;\n  if ($('#withdrawalWalletId')) $('#withdrawalWalletId').value = walletsCache.find(item => item.active !== false)?.id || '';`
  );

  text = text.replace(
    `  if (target.dataset.editTx) return openTransaction(txCache.find(item => item.id === target.dataset.editTx));`,
    `  if (target.dataset.editWallet) return openWallet(walletById(target.dataset.editWallet));\n  if (target.dataset.editCard) return openCard(cardById(target.dataset.editCard));\n  if (target.dataset.toggleWallet) {\n    const wallet = walletById(target.dataset.toggleWallet);\n    if (!wallet) return;\n    if (wallet.active !== false && cardsCache.some(card => card.active !== false && card.paymentWalletId === wallet.id)) return toast('Altere primeiro a carteira de pagamento dos cartões ativos.');\n    await runAction(target, async () => { await updateDoc(userDoc('wallets', wallet.id), { active:wallet.active === false, updatedAt:serverTimestamp() }); await loadAll(); }, wallet.active === false ? 'Carteira reativada' : 'Carteira arquivada');\n    return;\n  }\n  if (target.dataset.toggleCard) {\n    const card = cardById(target.dataset.toggleCard);\n    if (!card) return;\n    await runAction(target, async () => { await updateDoc(userDoc('cards', card.id), { active:card.active === false, updatedAt:serverTimestamp() }); await loadAll(); }, card.active === false ? 'Cartão reativado' : 'Cartão arquivado');\n    return;\n  }\n  if (target.dataset.deleteInstallmentGroup && confirm('Excluir todas as parcelas futuras desta compra? Parcelas já lançadas permanecem no histórico.')) {\n    const groupId = target.dataset.deleteInstallmentGroup;\n    await runAction(target, async () => { for (const item of scheduledCache.filter(row => row.status === 'active' && row.installmentGroupId === groupId)) await deleteDoc(userDoc('scheduled', item.id)); await loadAll(); }, 'Parcelas futuras excluídas');\n    return;\n  }\n  if (target.dataset.editTx) return openTransaction(txCache.find(item => item.id === target.dataset.editTx));`
  );

  text = text.replace(
    `const positionRows = positionsCache.map(p => [p.type, p.name, safeNumber(p.value)]);\n  positionRows.push(['asset','Patrimônio por aportes (automático)', positions.contributionAssets]);`,
    `const positionRows = positionsCache.map(p => [p.type, p.name, safeNumber(p.value), p.debtKind ? debtKindLabel(p.debtKind) : '', p.institution || '', safeNumber(p.originalAmount), safeNumber(p.installmentAmount), p.totalInstallments || '', p.paidInstallments || '', safeNumber(p.interestRate), p.dueDay || '', p.notes || '']);\n  positionRows.push(['asset','Patrimônio por aportes (automático)', positions.contributionAssets,'','','','','','','','','']);\n  const walletRows = walletMetrics(walletsCache, cardsCache, txCache, ymd(new Date())).byWallet.map(w => [w.institution,w.name,walletTypeLabel(w.type),safeNumber(w.initialBalance),safeNumber(w.balance),w.active === false ? 'Arquivada' : 'Ativa']);\n  const cardRows = cardDebtMetrics(cardsCache, txCache, scheduledCache, ymd(new Date())).byCard.map(c => [c.institution,c.name,safeNumber(c.creditLimit),safeNumber(c.open),safeNumber(c.nextInvoice),safeNumber(c.availableLimit),c.closingDay,c.dueDay,walletById(c.paymentWalletId)?.name || '',c.active === false ? 'Arquivado' : 'Ativo']);`
  );
  text = text.replace(`['Patrimônio por aportes', positions.contributionAssets],`, `['Patrimônio por aportes', positions.contributionAssets],\n      ['Saldo em carteiras', positions.walletAssets],\n      ['Dívidas manuais', positions.manualDebts],\n      ['Cartões em aberto', positions.cardDebts],`);
  text = text.replace(
    `sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem'],txCache.map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual'])),\n    sheetXml('Patrimônio',['Tipo','Nome','Valor'],positionRows),`,
    `sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem','Carteira','Cartão','Parcela'],txCache.map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual',walletById(tx.walletId)?.name || '',cardById(tx.cardId)?.name || '',tx.installmentTotal ? \`${'${tx.installmentNumber}/${tx.installmentTotal}'}\` : ''])),\n    sheetXml('Carteiras',['Instituição','Nome','Tipo','Saldo inicial','Saldo atual','Status'],walletRows),\n    sheetXml('Cartões',['Instituição','Nome','Limite','Em aberto','Próxima fatura','Limite disponível','Fechamento','Vencimento','Carteira pagadora','Status'],cardRows),\n    sheetXml('Patrimônio',['Tipo','Nome','Valor atual','Composição','Instituição','Valor original','Parcela','Total parcelas','Pagas','Juros a.a.','Vencimento','Observações'],positionRows),`
  );
  text = text.replace(
    `txCache = []; positionsCache = []; recurringCache = []; scheduledCache = []; monthlyGoalsCache = []; settings = {};`,
    `txCache = []; positionsCache = []; recurringCache = []; scheduledCache = []; walletsCache = []; cardsCache = []; monthlyGoalsCache = []; settings = {};`
  );

  return text;
});

patch('mobile/index.html', text => replaceOnce(
  text,
  `<label>Data<input id="editDate" type="date" /></label>`,
  `<label>Data<input id="editDate" type="date" /></label><label class="wide">Carteira<select id="editWallet"></select><small class="muted">Parcelamentos no cartão podem ser cadastrados na versão Web completa.</small></label>`,
  'mobile wallet selector'
));

patch('mobile/mobile.js', text => {
  text = replaceOnce(
    text,
    `CONTRIBUTION_CATEGORY, monthMetrics, periodSpendingMetrics, positionMetrics, safeNumber, ymd`,
    `CONTRIBUTION_CATEGORY, cardDebtMetrics, monthMetrics, periodSpendingMetrics, positionMetrics, safeNumber, walletMetrics, ymd`,
    'mobile finance imports'
  );
  text = replaceOnce(text, `let recurringCache = [];`, `let recurringCache = [];\nlet walletsCache = [];\nlet cardsCache = [];\nlet scheduledCache = [];`, 'mobile account caches');
  text = replaceRegex(text, /async function loadData\(\) \{[\s\S]*?\n}\nfunction renderDashboard/, `async function loadData() {
  if (!user || loading) return;
  loading = true;
  $('#syncBadge').textContent = 'Atualizando';
  try {
    const [txSnap, posSnap, recSnap, walletSnap, cardSnap, scheduledSnap] = await Promise.all([
      getDocs(userCol('transactions')),
      getDocs(userCol('positions')),
      getDocs(userCol('recurring')),
      getDocs(userCol('wallets')),
      getDocs(userCol('cards')),
      getDocs(userCol('scheduled'))
    ]);
    txCache = txSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    positionsCache = posSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    recurringCache = recSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    walletsCache = walletSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    cardsCache = cardSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    scheduledCache = scheduledSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    const walletSelect = $('#editWallet');
    if (walletSelect) {
      const previous = walletSelect.value || localStorage.getItem('mp:lastWallet') || '';
      const active = walletsCache.filter(item => item.active !== false);
      walletSelect.innerHTML = `<option value="">${active.length ? 'Selecione a carteira' : 'Cadastre uma carteira na Web'}</option>` + active.map(item => `<option value="${item.id}">${esc(item.institution)} · ${esc(item.name)}</option>`).join('');
      walletSelect.value = active.some(item => item.id === previous) ? previous : active[0]?.id || '';
    }
    renderDashboard();
    renderRecent();
    lastResumeSync = Date.now();
    $('#syncBadge').textContent = 'Sincronizado';
  } finally {
    loading = false;
  }
}
function renderDashboard`, 'mobile load accounts');
  text = replaceOnce(
    text,
    `const positions = positionMetrics(positionsCache,txCache,ymd(new Date()));`,
    `const positions = positionMetrics(positionsCache,txCache,ymd(new Date()),walletsCache,cardsCache,scheduledCache);`,
    'mobile net worth accounts'
  );
  text = text.replace(
    `<div class="recent-main"><strong>\${esc(tx.description || tx.category)}</strong><small>\${esc(tx.category)} · \${formatDate(tx.date)}</small></div>`,
    `<div class="recent-main"><strong>\${esc(tx.description || tx.category)}</strong><small>\${esc(tx.category)} · \${formatDate(tx.date)}\${walletsCache.find(w => w.id === tx.walletId) ? ` · ${esc(walletsCache.find(w => w.id === tx.walletId).name)}` : ''}</small></div>`
  );
  text = text.replace(
    `const ref = await addDoc(userCol('transactions'), { ...data, recurring:false, createdAt:serverTimestamp() });`,
    `const walletId = $('#editWallet')?.value || null;\n    if (walletsCache.some(item => item.active !== false) && !walletId) { toast('Selecione a carteira.'); return; }\n    if (walletId) localStorage.setItem('mp:lastWallet', walletId);\n    const ref = await addDoc(userCol('transactions'), { ...data, walletId, cardId:null, recurring:false, createdAt:serverTimestamp() });`
  );
  text = text.replace(`txCache=[]; positionsCache=[]; recurringCache=[]; renderParsed(null);`, `txCache=[]; positionsCache=[]; recurringCache=[]; walletsCache=[]; cardsCache=[]; scheduledCache=[]; renderParsed(null);`);
  return text;
});

patch('styles.css', text => text + `

/* Carteiras, cartões e composição de dívidas */
.account-hub{margin-bottom:14px}.account-head{align-items:flex-start;gap:18px}.account-head p{max-width:720px;margin:6px 0 0}.account-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0 20px}.account-summary>div,.card-stats>div{padding:12px;border-radius:14px;background:rgba(5,17,30,.55);border:1px solid rgba(148,163,184,.1)}.account-summary span,.card-stats span,.account-balance span{display:block;font-size:.74rem;color:#8fa2b8}.account-summary strong{display:block;margin-top:3px;font-size:1.14rem}.account-section-title{display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px}.account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.account-card{padding:14px;border-radius:16px;background:linear-gradient(145deg,rgba(12,31,50,.9),rgba(7,21,35,.92));border:1px solid rgba(110,168,255,.14)}.account-card.inactive{opacity:.58}.account-card-top{display:flex;align-items:center;gap:10px}.account-card-top strong,.account-card-top small{display:block}.account-card-top small{color:#8fa2b8;margin-top:2px}.account-logo{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(110,168,255,.1)}.account-balance{display:flex;align-items:end;justify-content:space-between;margin:15px 0 9px}.account-balance strong{font-size:1.25rem}.card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:13px 0}.card-stats strong{display:block;margin-top:3px}.installment-list{display:grid;gap:8px}.installment-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:11px 12px;border-radius:13px;background:rgba(5,17,30,.48);border:1px solid rgba(148,163,184,.08)}.installment-row strong,.installment-row small{display:block}.installment-row small{color:#8fa2b8;margin-top:2px}.routing-box,.debt-fields{display:grid;gap:10px;padding:12px;border-radius:14px;background:rgba(110,168,255,.06);border:1px solid rgba(110,168,255,.12)}.routing-hint{grid-column:1/-1;line-height:1.4}.debt-fields>.card-kicker{margin-bottom:-2px}.debt-progress{height:5px;border-radius:99px;background:rgba(148,163,184,.12);overflow:hidden;margin-top:7px}.debt-progress i{display:block;height:100%;background:linear-gradient(90deg,#6ea8ff,#4fd1a3);border-radius:inherit}.account-help{font-size:.78rem;line-height:1.45;margin:-2px 0 2px}.form-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:720px){.account-summary,.account-grid{grid-template-columns:1fr}.card-stats{grid-template-columns:1fr 1fr}.installment-row{grid-template-columns:1fr auto}.installment-row>button{grid-column:1/-1;justify-self:start}.account-head{display:block}.account-head .button-row{margin-top:12px}.form-grid.two{grid-template-columns:1fr}}
`);

patch('sw.js', text => replaceOnce(text, `const CACHE='meu-patrimonio-v32';`, `const CACHE='meu-patrimonio-v33';`, 'root cache version'));
patch('mobile/sw.js', text => replaceOnce(text, `const CACHE = 'mp-mobile-v7';`, `const CACHE = 'mp-mobile-v8';`, 'mobile cache version'));

fs.writeFileSync('tests/wallets-cards.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDebtMetrics, cardInstallmentSchedule, positionMetrics, splitInstallmentAmounts, walletMetrics } from '../finance-logic.js';

test('parcelamento divide centavos sem alterar o total', () => {
  const parts = splitInstallmentAmounts(100, 3);
  assert.deepEqual(parts, [33.34,33.33,33.33]);
  assert.equal(Math.round(parts.reduce((a,b)=>a+b,0)*100), 10000);
});

test('vencimento respeita fechamento do cartão', () => {
  const before = cardInstallmentSchedule({ amount:1200, installments:3, purchaseDate:'2026-08-04', closingDay:5, dueDay:12 });
  assert.deepEqual(before.map(item=>item.date), ['2026-08-12','2026-09-12','2026-10-12']);
  const after = cardInstallmentSchedule({ amount:1200, installments:3, purchaseDate:'2026-08-06', closingDay:5, dueDay:12 });
  assert.deepEqual(after.map(item=>item.date), ['2026-09-12','2026-10-12','2026-11-12']);
});

test('saldo da carteira deriva do saldo inicial e dos lançamentos vinculados', () => {
  const wallets = [{id:'w1',initialBalance:1000}];
  const tx = [
    {walletId:'w1',type:'income',amount:500,date:'2026-08-01'},
    {walletId:'w1',type:'expense',amount:250,date:'2026-08-02'},
    {walletId:'w1',type:'expense',amount:100,date:'2026-09-01'}
  ];
  assert.equal(walletMetrics(wallets,[],tx,'2026-08-20').total,1250);
});

test('parcelas futuras permanecem como dívida de cartão até o vencimento', () => {
  const cards = [{id:'c1',creditLimit:5000}];
  const scheduled = [
    {cardId:'c1',status:'active',amount:300,dueDate:'2026-09-10',purchaseDate:'2026-08-10'},
    {cardId:'c1',status:'active',amount:300,dueDate:'2026-10-10',purchaseDate:'2026-08-10'},
    {cardId:'c1',status:'posted',amount:300,dueDate:'2026-08-10',purchaseDate:'2026-08-10'}
  ];
  const metric = cardDebtMetrics(cards,[],scheduled,'2026-08-20');
  assert.equal(metric.total,600);
  assert.equal(metric.byCard[0].availableLimit,4400);
});

test('patrimônio integra carteiras e cartão sem saldo duplicado', () => {
  const positions = [{type:'asset',value:10000},{type:'debt',value:2000}];
  const wallets = [{id:'w1',initialBalance:5000}];
  const cards = [{id:'c1',creditLimit:5000}];
  const tx = [{walletId:'w1',type:'expense',amount:1000,date:'2026-08-10'}];
  const scheduled = [{cardId:'c1',walletId:'w1',status:'active',amount:600,dueDate:'2026-09-10',purchaseDate:'2026-08-10'}];
  const metric = positionMetrics(positions,tx,'2026-08-20',wallets,cards,scheduled);
  assert.equal(metric.walletAssets,4000);
  assert.equal(metric.cardDebts,600);
  assert.equal(metric.debts,2600);
  assert.equal(metric.netWorth,11400);
});
`);

fs.writeFileSync('tests/wallet-security.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260820143000_wallets_cards_debt_composition.sql', import.meta.url), 'utf8');

test('novas tabelas mantêm RLS forçado e isolamento por usuário', () => {
  for (const table of ['wallets','cards']) {
    assert.match(sql, new RegExp('alter table public\\\\.' + table + ' force row level security','i'));
    assert.match(sql, new RegExp('create policy ' + table + '_owner_only','i'));
    assert.match(sql, new RegExp('create policy ' + table + '_permanent_users_only','i'));
  }
  assert.match(sql,/grant select, insert, update, delete on table public\\.wallets, public\\.cards to authenticated/i);
  assert.doesNotMatch(sql,/grant .* to anon/i);
});

test('vínculos financeiros usam chaves compostas do mesmo usuário', () => {
  assert.match(sql,/foreign key \(user_id, "paymentWalletId"\) references public\\.wallets\(user_id, id\)/i);
  assert.match(sql,/transactions_wallet_fk foreign key \(user_id, "walletId"\)/i);
  assert.match(sql,/transactions_card_fk foreign key \(user_id, "cardId"\)/i);
  assert.match(sql,/scheduled_card_requires_wallet/i);
});
`);

console.log('Wallet/card/debt patch aplicado com sucesso.');
