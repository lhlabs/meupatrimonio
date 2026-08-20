from pathlib import Path

# Web app final semantics and editing safety.
app = Path('app.js')
s = app.read_text()
replacements = [
    ("if (patrimonyLabels[0]) patrimonyLabels[0].textContent = 'Carteiras';", "if (patrimonyLabels[0]) patrimonyLabels[0].textContent = 'Ativos';", 'patrimony label'),
    ("$('#assetsTotal').textContent = currency.format(positions.walletAssets);", "$('#assetsTotal').textContent = currency.format(positions.assets);", 'assets metric'),
    ("$('#transactionFirstInvoiceMonth').value = String(sample.firstInvoiceMonth || sample.dueDate || '').slice(0, 7);", "$('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);", 'edit invoice source'),
    ("      firstInvoiceMonth, installmentGroupId:groupId, installmentNumber, installmentTotal:totalInstallments,", "      installmentGroupId:groupId, installmentNumber, installmentTotal:totalInstallments,", 'edit persistence'),
    ("          walletId:card.paymentWalletId, cardId:card.id, purchaseDate:date, firstInvoiceMonth,\n          installmentGroupId:groupId, installmentNumber:part.installmentNumber, installmentTotal:part.installmentTotal,", "          walletId:card.paymentWalletId, cardId:card.id, purchaseDate:date,\n          installmentGroupId:groupId, installmentNumber:part.installmentNumber, installmentTotal:part.installmentTotal,", 'new persistence'),
]
for old, new, label in replacements:
    if s.count(old) != 1:
        raise SystemExit(f'{label}: expected 1 match, found {s.count(old)}')
    s = s.replace(old, new, 1)

old = """  $('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);
  $('#transactionFirstInvoiceMonth').dataset.manual = 'true';
  $('#transactionRoute').disabled = true;
"""
new = """  $('#transactionFirstInvoiceMonth').value = String(sample.dueDate || '').slice(0, 7);
  $('#transactionFirstInvoiceMonth').dataset.manual = 'true';
  const invoiceLabel = $('#transactionFirstInvoiceLabel');
  if (invoiceLabel?.childNodes[0]) invoiceLabel.childNodes[0].textContent = hasPosted ? 'Mês da próxima fatura' : 'Mês da primeira fatura';
  $('#transactionRoute').disabled = true;
"""
if s.count(old) != 1: raise SystemExit('invoice edit label mismatch')
s = s.replace(old, new, 1)

old = """  if ($('#transactionFirstInvoiceMonth')) { $('#transactionFirstInvoiceMonth').value = ''; $('#transactionFirstInvoiceMonth').dataset.manual = 'false'; }
  const amountLabel = $('#transactionAmount')?.closest('label');
"""
new = """  if ($('#transactionFirstInvoiceMonth')) { $('#transactionFirstInvoiceMonth').value = ''; $('#transactionFirstInvoiceMonth').dataset.manual = 'false'; }
  const invoiceLabel = $('#transactionFirstInvoiceLabel');
  if (invoiceLabel?.childNodes[0]) invoiceLabel.childNodes[0].textContent = 'Mês da primeira fatura';
  const amountLabel = $('#transactionAmount')?.closest('label');
"""
if s.count(old) != 1: raise SystemExit('invoice new label reset mismatch')
s = s.replace(old, new, 1)
app.write_text(s)

# Static HTML labels must match runtime semantics immediately.
index = Path('index.html')
s = index.read_text()
for old, new, label in [
    ('<div class="card-kicker">PATRIMÔNIO LÍQUIDO</div>', '<div class="card-kicker">PATRIMÔNIO</div>', 'root hero label'),
    ('<article class="mini-metric"><span>Dívidas</span><strong id="debtsTotal">R$ 0</strong></article>', '<article class="mini-metric"><span>Dívidas (informativo)</span><strong id="debtsTotal">R$ 0</strong></article>', 'root debt label'),
    ('<article class="mini-metric"><span>Patrimônio líquido</span><strong id="patrimonyNetWorth">R$ 0</strong></article>', '<article class="mini-metric"><span>Patrimônio</span><strong id="patrimonyNetWorth">R$ 0</strong></article>', 'root patrimony label'),
]:
    if s.count(old) != 1: raise SystemExit(f'{label}: expected 1 match, found {s.count(old)}')
    s = s.replace(old, new, 1)
index.write_text(s)

# Mobile uses the exact same patrimony definition; debt stays visible only as context.
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
mobile.write_text(s.replace(old, new, 1))

mobile_index = Path('mobile/index.html')
s = mobile_index.read_text()
old = '<span class="kicker">PATRIMÔNIO LÍQUIDO</span>'
new = '<span class="kicker">PATRIMÔNIO</span>'
if s.count(old) != 1: raise SystemExit('mobile hero label mismatch')
mobile_index.write_text(s.replace(old, new, 1))

# Regression: no unsupported column is written; editing starts from next active invoice after posted installments.
test = Path('tests/card-editing-integrity.test.mjs')
test.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('card purchase exposes first invoice month and installment editing', () => {
  assert.match(app, /id=\\\"transactionFirstInvoiceMonth\\\" type=\\\"month\\\"/);
  assert.match(app, /function openInstallmentGroup\\(groupId\\)/);
  assert.match(app, /data-edit-installment-group/);
});

test('editing after posted installments starts from the next active invoice', () => {
  assert.match(app, /transactionFirstInvoiceMonth'\\)\\.value = String\\(sample\\.dueDate/);
  assert.doesNotMatch(app, /sample\\.firstInvoiceMonth \\|\\| sample\\.dueDate/);
});

test('first invoice choice is represented by due dates without adding an unsupported scheduled column', () => {
  assert.doesNotMatch(app, /purchaseDate:date, firstInvoiceMonth/);
  assert.doesNotMatch(app, /firstInvoiceMonth, installmentGroupId/);
});
""")
