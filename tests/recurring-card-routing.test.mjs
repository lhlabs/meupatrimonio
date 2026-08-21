import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cardInstallmentSchedule } from '../finance-logic.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('recorrências podem ser vinculadas a cartão sem débito imediato na carteira', () => {
  assert.match(app, /id=\"recurringRoute\"/);
  assert.match(app, /id=\"recurringCardId\"/);
  assert.match(app, /const data = \{ name, type, amount, category, description: name, dayOfMonth, startDate, endDate, active, walletId, cardId,/);
  assert.match(app, /recurringCardScheduleId\(recurring\.id, due\)/);
  assert.match(app, /installments:1, purchaseDate:due/);
  assert.match(app, /frequency:'once', status:'active', walletId:card\.paymentWalletId, cardId:card\.id/);
});

test('previsão mensal não duplica recorrência do cartão', () => {
  assert.match(app, /forecastRecurringRules\(\) \{ return recurringCache\.filter\(item => !item\.cardId\); \}/);
  assert.match(app, /recurringCache\.filter\(recurring => !recurring\.cardId\)/);
  assert.match(app, /!isRecurringCardSchedule\(item\)/);
});

test('editar ou excluir recorrência preserva histórico já realizado', () => {
  assert.match(app, /startsWith\(prefix\) && row\.status === 'active'/);
  assert.match(app, /Altere primeiro as recorrências vinculadas a este cartão/);
});

test('ciclo do cartão leva a compra recorrente para a fatura correta', () => {
  const [invoice] = cardInstallmentSchedule({
    amount: 99.90,
    installments: 1,
    purchaseDate: '2026-08-10',
    closingDay: 5,
    dueDay: 12
  });
  assert.equal(invoice.date, '2026-09-12');
  assert.equal(invoice.amount, 99.90);
});
