import test from 'node:test';
import assert from 'node:assert/strict';
import { monthMetrics, periodSpendingMetrics, recurringDue, shouldMaterializeRecurring } from '../finance-logic.js';

test('recorrência iniciada no mês conta no próprio mês mesmo se o dia nominal já passou', () => {
  const recurring = {
    active: true,
    type: 'expense',
    amount: 1200,
    dayOfMonth: 5,
    category: 'Moradia',
    startDate: '2026-08-19',
    endDate: ''
  };
  const due = recurringDue(recurring, new Date(2026, 7, 1));
  assert.equal(due, '2026-08-05');
  assert.equal(shouldMaterializeRecurring(due, '2026-08-19'), true);
});

test('receita recorrente antecipada alimenta renda, saldo e resultado pela mesma transação mensal', () => {
  const transactions = [
    { id:'rec_salary_2026-08', type:'income', amount:7000, date:'2026-08-30', category:'Salário', sourceType:'recurring' },
    { id:'rec_rent_2026-08', type:'expense', amount:2000, date:'2026-08-25', category:'Moradia', sourceType:'recurring' },
    { id:'market', type:'expense', amount:500, date:'2026-08-10', category:'Mercado' }
  ];
  const metrics = monthMetrics(transactions, new Date(2026, 7, 1));
  const spending = periodSpendingMetrics(transactions, [], new Date(2026, 7, 1), new Date(2026, 7, 19));
  assert.equal(metrics.income, 7000);
  assert.equal(metrics.consumption, 2500);
  assert.equal(metrics.balance, 4500);
  assert.equal(spending.recurringExpenses, 2000);
  assert.equal(spending.otherExpenses, 500);
  assert.equal(spending.totalExpenses, 2500);
});

test('o cálculo de gasto não soma a definição recorrente por fora da transação materializada', () => {
  const recurring = [
    { active:true, type:'expense', amount:2000, dayOfMonth:25, category:'Moradia', startDate:'2026-01-01', endDate:'' }
  ];
  const transactions = [
    { id:'rec_home_2026-08', type:'expense', amount:2000, date:'2026-08-25', category:'Moradia', sourceType:'recurring' }
  ];
  const spending = periodSpendingMetrics(transactions, recurring, new Date(2026, 7, 1), new Date(2026, 7, 19));
  assert.equal(spending.recurringExpenses, 2000);
  assert.equal(spending.totalExpenses, 2000);
});
