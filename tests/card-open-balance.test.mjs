import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDebtMetrics } from '../finance-logic.js';

const cards = [{
  id:'visa',
  name:'Visa',
  institution:'Banco',
  creditLimit:3000,
  closingDay:28,
  dueDay:7,
  paymentWalletId:'wallet',
  active:true
}];

const scheduled = [
  { id:'inst_1', status:'active', type:'expense', amount:100, dueDate:'2026-09-07', cardId:'visa', purchaseDate:'2026-08-20', installmentGroupId:'group', installmentNumber:1, installmentTotal:3 },
  { id:'inst_2', status:'active', type:'expense', amount:100, dueDate:'2026-10-07', cardId:'visa', purchaseDate:'2026-08-20', installmentGroupId:'group', installmentNumber:2, installmentTotal:3 },
  { id:'inst_3', status:'active', type:'expense', amount:100, dueDate:'2026-11-07', cardId:'visa', purchaseDate:'2026-08-20', installmentGroupId:'group', installmentNumber:3, installmentTotal:3 },
  { id:'recurring_card', status:'active', type:'expense', amount:50, dueDate:'2026-09-07', cardId:'visa', purchaseDate:'2026-08-20' }
];

test('card open balance includes every unpaid installment of an incurred purchase', () => {
  const result = cardDebtMetrics(cards, [], scheduled, '2026-08-21');
  const visa = result.byCard[0];

  assert.equal(visa.open, 350);
  assert.equal(visa.incurredOpen, 350);
  assert.equal(visa.nextInvoice, 150);
  assert.equal(visa.nextDue, '2026-09-07');
  assert.equal(visa.availableLimit, 2650);
  assert.equal(result.total, 350);
  assert.equal(result.incurredTotal, 350);
});

test('paying one installment restores only that installment of available limit', () => {
  const installmentOnly = scheduled
    .filter(item => item.id !== 'recurring_card')
    .map(item => item.id === 'inst_1' ? { ...item, status:'posted' } : item);
  const visa = cardDebtMetrics(cards, [], installmentOnly, '2026-09-08').byCard[0];

  assert.equal(visa.open, 200);
  assert.equal(visa.availableLimit, 2800);
  assert.equal(visa.nextDue, '2026-10-07');
  assert.equal(visa.nextInvoice, 100);
});
