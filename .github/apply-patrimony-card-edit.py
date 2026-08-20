from pathlib import Path

finance = Path('finance-logic.js')
s = finance.read_text()
old = "export function cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay, dueDay }) {"
new = "export function cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay, dueDay, firstInvoiceMonth = '' }) {"
if s.count(old) != 1: raise SystemExit('cardInstallmentSchedule signature mismatch')
s = s.replace(old, new, 1)
old = """  const closingDate = dueDateFor(year, month - 1, close);
  const statementMonth = new Date(year, month - 1 + (String(purchaseDate) >= closingDate ? 1 : 0), 1, 12);
  const firstDueMonth = new Date(statementMonth);
  if (due <= close) firstDueMonth.setMonth(firstDueMonth.getMonth() + 1);
"""
new = """  let firstDueMonth;
  const manualInvoiceMonth = String(firstInvoiceMonth || '');
  if (manualInvoiceMonth) {
    const invoiceMatch = /^(\\d{4})-(\\d{2})$/.exec(manualInvoiceMonth);
    if (!invoiceMatch) return [];
    const invoiceYear = Number(invoiceMatch[1]), invoiceMonth = Number(invoiceMatch[2]);
    if (invoiceMonth < 1 || invoiceMonth > 12) return [];
    firstDueMonth = new Date(invoiceYear, invoiceMonth - 1, 1, 12);
    const firstDueDate = dueDateFor(invoiceYear, invoiceMonth - 1, due);
    if (firstDueDate < String(purchaseDate)) return [];
  } else {
    const closingDate = dueDateFor(year, month - 1, close);
    const statementMonth = new Date(year, month - 1 + (String(purchaseDate) >= closingDate ? 1 : 0), 1, 12);
    firstDueMonth = new Date(statementMonth);
    if (due <= close) firstDueMonth.setMonth(firstDueMonth.getMonth() + 1);
  }
"""
if s.count(old) != 1: raise SystemExit('cardInstallmentSchedule month block mismatch')
s = s.replace(old, new, 1)
if s.count('netWorth: assets - debts') != 1: raise SystemExit('netWorth formula mismatch')
s = s.replace('netWorth: assets - debts', 'netWorth: assets', 1)
finance.write_text(s)

app = Path('app.js')
s = app.read_text()
old = """  const spendingLabel = $('#debtValue')?.closest('.mini-metric')?.querySelector('span');
  if (spendingLabel) spendingLabel.textContent = 'Gastos do período';
"""
new = old + """  const patrimonyKicker = $('#netWorth')?.closest('.networth-card')?.querySelector('.card-kicker');
  if (patrimonyKicker) patrimonyKicker.textContent = 'PATRIMÔNIO';
  const patrimonyLabels = $$('#patrimonySection .metric-strip .mini-metric > span');
  if (patrimonyLabels[0]) patrimonyLabels[0].textContent = 'Carteiras';
  if (patrimonyLabels[1]) patrimonyLabels[1].textContent = 'Dívidas (informativo)';
  if (patrimonyLabels[2]) patrimonyLabels[2].textContent = 'Patrimônio';
"""
if s.count(old) != 1: raise SystemExit('prepareUi insertion mismatch')
s = s.replace(old, new, 1)
if s.count('<div><span>Disponível líquido</span><strong id="accountsLiquid">R$ 0</strong></div>') != 1: raise SystemExit('account summary label mismatch')
s = s.replace('<div><span>Disponível líquido</span><strong id="accountsLiquid">R$ 0</strong></div>', '<div><span>Limite disponível</span><strong id="accountsLiquid">R$ 0</strong></div>', 1)
old = "$('#accountsLiquid').textContent = currency.format(wallets.total - cards.total);"
new = "$('#accountsLiquid').textContent = currency.format(cards.byCard.reduce((sum, item) => sum + safeNumber(item.availableLimit), 0));"
if s.count(old) != 1: raise SystemExit('accountsLiquid formula mismatch')
s = s.replace(old, new, 1)
old = """  box.innerHTML = `<label>Movimentar em<select id=\"transactionRoute\"><option value=\"wallet\">Carteira / conta</option><option value=\"card\">Cartão de crédito</option><option value=\"none\">Sem carteira (legado)</option></select></label><label id=\"transactionWalletLabel\">Carteira<select id=\"transactionWalletId\"></select></label><label id=\"transactionCardLabel\" class=\"hidden\">Cartão<select id=\"transactionCardId\"></select></label><label id=\"transactionInstallmentsLabel\" class=\"hidden\">Parcelas<select id=\"transactionInstallments\">${Array.from({length:60},(_,i)=>`<option value=\"${i+1}\">${i+1}x</option>`).join('')}</select></label><small id=\"transactionRouteHint\" class=\"muted routing-hint\"></small>`;
  form.insertBefore(box, recurringLabel);
  $('#transactionRoute').addEventListener('change', syncTransactionRouting);
  $('#transactionCardId').addEventListener('change', syncTransactionRouting);
"""
new = """  box.innerHTML = `<label>Movimentar em<select id=\"transactionRoute\"><option value=\"wallet\">Carteira / conta</option><option value=\"card\">Cartão de crédito</option><option value=\"none\">Sem carteira (legado)</option></select></label><label id=\"transactionWalletLabel\">Carteira<select id=\"transactionWalletId\"></select></label><label id=\"transactionCardLabel\" class=\"hidden\">Cartão<select id=\"transactionCardId\"></select></label><label id=\"transactionInstallmentsLabel\" class=\"hidden\">Parcelas<select id=\"transactionInstallments\">${Array.from({length:60},(_,i)=>`<option value=\"${i+1}\">${i+1}x</option>`).join('')}</select></label><label id=\"transactionFirstInvoiceLabel\" class=\"hidden\">Mês da primeira fatura<input id=\"transactionFirstInvoiceMonth\" type=\"month\"></label><small id=\"transactionRouteHint\" class=\"muted routing-hint\"></small>`;
  form.insertBefore(box, recurringLabel);
  $('#transactionRoute').addEventListener('change', () => { syncTransactionRouting(); syncFirstInvoiceMonth(); });
  $('#transactionCardId').addEventListener('change', () => syncFirstInvoiceMonth(true));
  $('#transactionDate').addEventListener('change', () => syncFirstInvoiceMonth(true));
  $('#transactionFirstInvoiceMonth').addEventListener('change', event => { event.target.dataset.manual = 'true'; });
"""
if s.count(old) != 1: raise SystemExit('routing UI mismatch')
s = s.replace(old, new, 1)
marker = "function syncTransactionRouting() {"
helper = """function syncFirstInvoiceMonth(force = false) {
  const input = $('#transactionFirstInvoiceMonth');
  if (!input || $('#transactionRoute')?.value !== 'card' || $('#transactionType')?.value !== 'expense') return;
  if (!force && input.dataset.manual === 'true' && input.value) return;
  const card = cardById($('#transactionCardId')?.value);
  const purchaseDate = $('#transactionDate')?.value;
  if (!card || !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(purchaseDate || ''))) return;
  const preview = cardInstallmentSchedule({ amount:1, installments:1, purchaseDate, closingDay:card.closingDay, dueDay:card.dueDay });
  input.min = purchaseDate.slice(0, 7);
  input.value = preview[0]?.date?.slice(0, 7) || purchaseDate.slice(0, 7);
  input.dataset.manual = 'false';
}

"""
if s.count(marker) != 1: raise SystemExit('syncTransactionRouting marker mismatch')
s = s.replace(marker, helper + marker, 1)
old = """  $('#transactionCardLabel')?.classList.toggle('hidden', !cardMode);
  $('#transactionInstallmentsLabel')?.classList.toggle('hidden', !cardMode);
"""
new = old + "  $('#transactionFirstInvoiceLabel')?.classList.toggle('hidden', !cardMode);\n"
if s.count(old) != 1: raise SystemExit('routing visibility mismatch')
s = s.replace(old, new, 1)
old = """  if (hint) hint.textContent = cardMode ? 'O valor informado é o total da compra. As parcelas entram nos meses de vencimento da fatura e a carteira pagadora é movimentada automaticamente.' : route === 'wallet' ? 'Esta movimentação altera o saldo da carteira escolhida.' : 'Lançamentos sem carteira ficam fora dos saldos por instituição.';
}
"""
new = """  if (hint) hint.textContent = cardMode ? 'O valor informado é o total da compra. Escolha o mês da primeira fatura; as parcelas seguintes avançam mês a mês e a carteira pagadora só é movimentada no vencimento.' : route === 'wallet' ? 'Esta movimentação altera o saldo da carteira escolhida.' : 'Lançamentos sem carteira ficam fora dos saldos por instituição.';
  if (cardMode) syncFirstInvoiceMonth();
}
"""
if s.count(old) != 1: raise SystemExit('routing hint mismatch')
s = s.replace(old, new, 1)
marker = "function openTransaction(tx = null) {"
helper = r'''function openInstallmentGroup(groupId) {
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
  $('#transactionFirstInvoiceMonth').value = String(sample.firstInvoiceMonth || sample.dueDate || '').slice(0, 7);
  $('#transactionFirstInvoiceMonth').dataset.manual = 'true';
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
  const existingNumbers = active.map(item => Math.trunc(safeNumber(item.installmentNumber))).filter(Boolean);
  const totalInstallments = hasPosted ? Math.trunc(safeNumber(sample.installmentTotal) || (posted.length + active.length)) : installments;
  for (const item of active) await deleteDoc(userDoc('scheduled', item.id));
  for (let index = 0; index < schedule.length; index += 1) {
    const part = schedule[index];
    const installmentNumber = hasPosted ? (existingNumbers[index] || posted.length + index + 1) : part.installmentNumber;
    const scheduledId = `inst_${groupId}_${String(installmentNumber).padStart(3,'0')}`;
    await setDoc(userDoc('scheduled', scheduledId), {
      name: `${description || category} · ${installmentNumber}/${totalInstallments}`,
      type:'expense', amount:part.amount, category, description:description || category,
      dueDate:part.date, frequency:'once', status:'active',
      walletId:card.paymentWalletId, cardId:card.id, purchaseDate,
      firstInvoiceMonth, installmentGroupId:groupId, installmentNumber, installmentTotal:totalInstallments,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
  }
}

'''
if s.count(marker) != 1: raise SystemExit('openTransaction marker mismatch')
s = s.replace(marker, helper + marker, 1)
old = """function openTransaction(tx = null) {
  if (tx?.installmentGroupId) return toast('Compras parceladas são gerenciadas em Carteiras & patrimônio.');
"""
new = """function openTransaction(tx = null) {
  if (tx?.installmentGroupId) return openInstallmentGroup(tx.installmentGroupId);
  $('#transactionRoute').disabled = false;
  $('#transactionCardId').disabled = false;
  $('#transactionDate').disabled = false;
  $('#transactionInstallments').disabled = false;
  if ($('#transactionFirstInvoiceMonth')) { $('#transactionFirstInvoiceMonth').value = ''; $('#transactionFirstInvoiceMonth').dataset.manual = 'false'; }
  const amountLabel = $('#transactionAmount')?.closest('label');
  if (amountLabel?.childNodes[0]) amountLabel.childNodes[0].textContent = 'Valor';
"""
if s.count(old) != 1: raise SystemExit('openTransaction start mismatch')
s = s.replace(old, new, 1)
old = """  if (tx.projected) actions = '<span class=\"muted\">Previsto</span>';
  else if (tx.installmentGroupId) actions = '<span class=\"muted\">Parcela</span>';
"""
new = """  if (tx.projected && tx.installmentGroupId) actions = `<button class=\"mini-btn\" data-edit-installment-group=\"${esc(tx.installmentGroupId)}\">Editar</button><span class=\"muted\">Previsto</span>`;
  else if (tx.projected) actions = '<span class=\"muted\">Previsto</span>';
  else if (tx.installmentGroupId) actions = `<button class=\"mini-btn\" data-edit-installment-group=\"${esc(tx.installmentGroupId)}\">Editar futuras</button><span class=\"muted\">Parcela</span>`;
"""
if s.count(old) != 1: raise SystemExit('txRow actions mismatch')
s = s.replace(old, new, 1)
old = """    return `<div class=\"installment-row\"><div><strong>${esc(group.description || 'Compra parcelada')}</strong><small>${esc(card?.name || 'Cartão')} · ${paid}/${group.total} pagas · próxima ${formatDate(active[0]?.dueDate)}</small></div><div><strong>${currency.format(remaining)}</strong><small>saldo parcelado</small></div><button class=\"mini-btn danger\" data-delete-installment-group=\"${esc(group.id)}\">Excluir futuras</button></div>`;
"""
new = """    const firstInvoice = active[0]?.dueDate ? monthLabel(dateFromMonthKey(String(active[0].dueDate).slice(0,7))) : '—';
    return `<div class=\"installment-row\"><div><strong>${esc(group.description || 'Compra parcelada')}</strong><small>${esc(card?.name || 'Cartão')} · ${paid}/${group.total} pagas · 1ª fatura futura ${esc(firstInvoice)} · próxima ${formatDate(active[0]?.dueDate)}</small></div><div><strong>${currency.format(remaining)}</strong><small>saldo parcelado</small></div><div class=\"row-actions\"><button class=\"mini-btn\" data-edit-installment-group=\"${esc(group.id)}\">Editar</button><button class=\"mini-btn danger\" data-delete-installment-group=\"${esc(group.id)}\">Excluir futuras</button></div></div>`;
"""
if s.count(old) != 1: raise SystemExit('installment group row mismatch')
s = s.replace(old, new, 1)
old = """  if (target.dataset.deleteInstallmentGroup && confirm('Excluir todas as parcelas futuras desta compra? Parcelas já lançadas permanecem no histórico.')) {
"""
new = """  if (target.dataset.editInstallmentGroup) { openInstallmentGroup(target.dataset.editInstallmentGroup); return; }
  if (target.dataset.deleteInstallmentGroup && confirm('Excluir todas as parcelas futuras desta compra? Parcelas já lançadas permanecem no histórico.')) {
"""
if s.count(old) != 1: raise SystemExit('installment click handler mismatch')
s = s.replace(old, new, 1)
old = """    const route = $('#transactionRoute')?.value || 'none';
    if (!(amount > 0) || !['income','expense'].includes(type) || !category || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('Lançamento inválido');
    if (id) {
"""
new = """    const route = $('#transactionRoute')?.value || 'none';
    if (!(amount > 0) || !['income','expense'].includes(type) || !category || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('Lançamento inválido');
    const installmentGroupEdit = id.startsWith('installment:') ? id.slice('installment:'.length) : '';
    if (installmentGroupEdit) {
      if (type !== 'expense' || route !== 'card') throw new Error('Compra no cartão inválida');
      await saveInstallmentGroupEdit(installmentGroupEdit, { amount, category, description, purchaseDate:date });
    } else if (id) {
"""
if s.count(old) != 1: raise SystemExit('transaction edit branch mismatch')
s = s.replace(old, new, 1)
old = """      const installments = Math.trunc(safeNumber($('#transactionInstallments').value || 1));
      if (!card || card.active === false || installments < 1 || installments > 60) throw new Error('Cartão ou parcelamento inválido');
      const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate:date, closingDay:card.closingDay, dueDay:card.dueDay });
      if (schedule.length !== installments) throw new Error('O valor é baixo demais para a quantidade de parcelas');
"""
new = """      const installments = Math.trunc(safeNumber($('#transactionInstallments').value || 1));
      const firstInvoiceMonth = $('#transactionFirstInvoiceMonth').value;
      if (!card || card.active === false || installments < 1 || installments > 60 || !/^\\d{4}-\\d{2}$/.test(firstInvoiceMonth)) throw new Error('Cartão, parcelamento ou primeira fatura inválidos');
      const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate:date, closingDay:card.closingDay, dueDay:card.dueDay, firstInvoiceMonth });
      if (schedule.length !== installments) throw new Error('A primeira fatura não pode vencer antes da compra e o valor deve comportar as parcelas');
"""
if s.count(old) != 1: raise SystemExit('new card schedule mismatch')
s = s.replace(old, new, 1)
old = """          walletId:card.paymentWalletId, cardId:card.id, purchaseDate:date,
          installmentGroupId:groupId, installmentNumber:part.installmentNumber, installmentTotal:part.installmentTotal,
"""
new = """          walletId:card.paymentWalletId, cardId:card.id, purchaseDate:date, firstInvoiceMonth,
          installmentGroupId:groupId, installmentNumber:part.installmentNumber, installmentTotal:part.installmentTotal,
"""
if s.count(old) != 1: raise SystemExit('scheduled firstInvoiceMonth storage mismatch')
s = s.replace(old, new, 1)
old = """  $('#netWorthContext').textContent = `${currency.format(positions.assets)} em ativos − ${currency.format(positions.debts)} em dívidas`;
"""
new = """  $('#netWorthContext').textContent = `${currency.format(positions.assets)} em ativos · ${currency.format(positions.debts)} em dívidas (informativo)`;
"""
if s.count(old) != 1: raise SystemExit('dashboard patrimony context mismatch')
s = s.replace(old, new, 1)
old = """  $('#assetsTotal').textContent = currency.format(positions.assets);
  $('#debtsTotal').textContent = currency.format(positions.debts);
  $('#patrimonyNetWorth').textContent = currency.format(positions.netWorth);
"""
new = """  $('#assetsTotal').textContent = currency.format(positions.walletAssets);
  $('#debtsTotal').textContent = currency.format(positions.debts);
  $('#patrimonyNetWorth').textContent = currency.format(positions.netWorth);
"""
if s.count(old) != 1: raise SystemExit('renderPositions metrics mismatch')
s = s.replace(old, new, 1)
old = """  if (positions.debts > 0) items.push(`Dívidas cadastradas: <b>${currency.format(positions.debts)}</b>. O saldo devedor entra no patrimônio líquido; parcelas mensais entram apenas no fluxo de caixa.`);
"""
new = """  if (positions.debts > 0) items.push(`Dívidas cadastradas: <b>${currency.format(positions.debts)}</b>. São exibidas para acompanhamento, mas não reduzem o patrimônio; pagamentos efetivos entram no fluxo de caixa.`);
"""
if s.count(old) != 1: raise SystemExit('planning debt diagnosis mismatch')
s = s.replace(old, new, 1)
app.write_text(s)

mobile = Path('mobile/mobile.js')
s = mobile.read_text()
old = """  $('#netWorth').textContent = currency.format(positions.netWorth);
  $('#netWorthDetail').textContent = `${currency.format(positions.assets)} em ativos − ${currency.format(positions.debts)} em dívidas`;
"""
new = """  $('#netWorth').textContent = currency.format(positions.netWorth);
  const patrimonyKicker = $('#netWorth')?.closest('.hero')?.querySelector('.kicker');
  if (patrimonyKicker) patrimonyKicker.textContent = 'PATRIMÔNIO';
  $('#netWorthDetail').textContent = `${currency.format(positions.assets)} em ativos · ${currency.format(positions.debts)} em dívidas (informativo)`;
"""
if s.count(old) != 1: raise SystemExit('mobile patrimony context mismatch')
mobile.write_text(s)

tests = Path('tests/wallets-cards.test.mjs')
t = tests.read_text()
t = t.replace("test('compra futura registrada já aparece em aberto e consome limite sem antecipar patrimônio', () => {", "test('compra futura registrada aparece em aberto e consome limite sem reduzir patrimônio', () => {", 1)
if "assert.equal(positionAfterPurchase.netWorth,400);" not in t: raise SystemExit('future purchase netWorth expectation missing')
t = t.replace("assert.equal(positionAfterPurchase.netWorth,400);", "assert.equal(positionAfterPurchase.netWorth,1000);", 1)
t = t.replace("test('patrimônio integra carteiras e cartão sem saldo duplicado', () => {", "test('patrimônio considera ativos enquanto dívidas ficam apenas informativas', () => {", 1)
if "assert.equal(metric.netWorth,11400);" not in t: raise SystemExit('integrated patrimony expectation missing')
t = t.replace("assert.equal(metric.netWorth,11400);", "assert.equal(metric.netWorth,14000);", 1)
t = t.replace("test('pagamento de parcela reduz caixa e dívida na mesma quantia sem alterar patrimônio líquido', () => {", "test('pagamento de parcela reduz patrimônio apenas quando o caixa efetivamente sai', () => {", 1)
if "  assert.equal(before.netWorth,400);\n  assert.equal(after.netWorth,400);" not in t: raise SystemExit('payment netWorth expectations missing')
t = t.replace("  assert.equal(before.netWorth,400);\n  assert.equal(after.netWorth,400);", "  assert.equal(before.netWorth,1000);\n  assert.equal(after.netWorth,700);", 1)
extra = r'''

test('mês manual da primeira fatura define o início do parcelamento', () => {
  const schedule = cardInstallmentSchedule({ amount:300, installments:3, purchaseDate:'2026-08-20', closingDay:28, dueDay:7, firstInvoiceMonth:'2026-10' });
  assert.deepEqual(schedule.map(item => item.date), ['2026-10-07','2026-11-07','2026-12-07']);
});

test('primeira fatura não pode vencer antes da data da compra', () => {
  const schedule = cardInstallmentSchedule({ amount:100, installments:1, purchaseDate:'2026-08-20', closingDay:28, dueDay:7, firstInvoiceMonth:'2026-08' });
  assert.deepEqual(schedule, []);
});

test('dívida manual permanece informativa e não reduz patrimônio', () => {
  const metric = positionMetrics([{type:'asset',value:5000},{type:'debt',value:3200}],[],'2026-08-20',[],[],[]);
  assert.equal(metric.assets,5000);
  assert.equal(metric.debts,3200);
  assert.equal(metric.netWorth,5000);
});
'''
if 'mês manual da primeira fatura define o início do parcelamento' in t: raise SystemExit('new tests already exist')
tests.write_text(t.rstrip() + extra + '\n')

sw = Path('sw.js')
rs = sw.read_text()
if 'meu-patrimonio-v41' not in rs: raise SystemExit('unexpected root cache version')
sw.write_text(rs.replace('meu-patrimonio-v41','meu-patrimonio-v42',1))
msw = Path('mobile/sw.js')
m = msw.read_text()
if 'mp-mobile-v15' not in m: raise SystemExit('unexpected mobile cache version')
msw.write_text(m.replace('mp-mobile-v15','mp-mobile-v16',1))
