import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('card purchase exposes first invoice month and installment editing', () => {
  assert.match(app, /id=\"transactionFirstInvoiceMonth\" type=\"month\"/);
  assert.match(app, /function openInstallmentGroup\(groupId\)/);
  assert.match(app, /data-edit-installment-group/);
});

test('editing after posted installments starts from the next active invoice', () => {
  assert.match(app, /transactionFirstInvoiceMonth'\)\.value = String\(sample\.dueDate/);
  assert.doesNotMatch(app, /sample\.firstInvoiceMonth \|\| sample\.dueDate/);
});

test('first invoice choice is represented by due dates without adding an unsupported scheduled column', () => {
  assert.doesNotMatch(app, /purchaseDate:date, firstInvoiceMonth/);
  assert.doesNotMatch(app, /firstInvoiceMonth, installmentGroupId/);
});
