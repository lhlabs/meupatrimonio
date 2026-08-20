from pathlib import Path

app = Path('app.js')
s = app.read_text()
old = """  $('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);
  $('#transactionFirstInvoiceMonth').dataset.manual = 'true';
  const invoiceLabel = $('#transactionFirstInvoiceLabel');
"""
new = """  $('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);
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
"""
if s.count(old) != 1: raise SystemExit('invoice minimum insertion mismatch')
s = s.replace(old, new, 1)

old = """  const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay:card.closingDay, dueDay:card.dueDay, firstInvoiceMonth });
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
      installmentGroupId:groupId, installmentNumber, installmentTotal:totalInstallments,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
  }
"""
new = """  const schedule = cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay:card.closingDay, dueDay:card.dueDay, firstInvoiceMonth });
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
"""
if s.count(old) != 1: raise SystemExit('safe installment rewrite mismatch')
s = s.replace(old, new, 1)
app.write_text(s)

test = Path('tests/card-editing-integrity.test.mjs')
t = test.read_text()
extra = """

test('posted installments cannot be moved back onto an already realized invoice', () => {
  assert.match(app, /schedule\[0\]\?\.date <= lastPostedDate/);
  assert.match(app, /A próxima fatura deve ser posterior à última parcela já realizada/);
});

test('editing writes replacement installments before deleting obsolete future rows', () => {
  const write = app.indexOf('const nextIds = new Set()');
  const cleanup = app.indexOf("if (!nextIds.has(item.id)) await deleteDoc");
  assert.ok(write >= 0 && cleanup > write);
});
"""
if 'posted installments cannot be moved back' in t: raise SystemExit('safety tests already exist')
test.write_text(t.rstrip() + extra + '\n')
