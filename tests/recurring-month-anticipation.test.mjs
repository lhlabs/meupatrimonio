import test from 'node:test';
import assert from 'node:assert/strict';
import { monthMetrics, periodSpendingMetrics, projectedRecurringRows, recurringDue, shouldMaterializeRecurring } from '../finance-logic.js';

test('recorrência iniciada no mês conta no próprio mês mesmo se o dia nominal já passou', () => {
  const recurring = {
    id: 'rent',
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
    { id:'rec_salary_2026-08', type:'income', amount:7000, date:'2026-08-30', category:'Salário', sourceType:'recurring', sourceId:'salary' },
    { id:'rec_rent_2026-08', type:'expense', amount:2000, date:'2026-08-25', category:'Moradia', sourceType:'recurring', sourceId:'rent' },
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

test('mês futuro incorpora receitas e despesas recorrentes no saldo antes do vencimento', () => {
  const transactions = [
    { id:'small', type:'expense', amount:51, date:'2026-09-02', category:'Mercado' }
  ];
  const recurring = [
    { id:'salary', active:true, type:'income', amount:10840, dayOfMonth:30, category:'Salário', name:'Salário', startDate:'2026-01-01', endDate:'' },
    { id:'rent', active:true, type:'expense', amount:1830, dayOfMonth:5, category:'Moradia', name:'Moradia', startDate:'2026-01-01', endDate:'' },
    { id:'gym', active:true, type:'expense', amount:70, dayOfMonth:10, category:'Academia', name:'Academia', startDate:'2026-01-01', endDate:'' },
    { id:'insurance', active:true, type:'expense', amount:200, dayOfMonth:20, category:'Seguros', name:'Seguro', startDate:'2026-01-01', endDate:'' }
  ];
  const september = new Date(2026, 8, 1);
  const now = new Date(2026, 7, 19);
  const metrics = monthMetrics(transactions, september, recurring, now);
  const spending = periodSpendingMetrics(transactions, recurring, september, now);
  assert.equal(metrics.income, 10840);
  assert.equal(metrics.consumption, 2151);
  assert.equal(metrics.balance, 8689);
  assert.equal(spending.recurringExpenses, 2100);
  assert.equal(spending.otherExpenses, 51);
  assert.equal(spending.totalExpenses, 2151);
});

test('recorrência materializada e definição recorrente nunca são contadas duas vezes', () => {
  const recurring = [
    { id:'rent', active:true, type:'expense', amount:2000, dayOfMonth:25, category:'Moradia', startDate:'2026-01-01', endDate:'' },
    { id:'salary', active:true, type:'income', amount:7000, dayOfMonth:30, category:'Salário', startDate:'2026-01-01', endDate:'' }
  ];
  const transactions = [
    { id:'rec_rent_2026-09', type:'expense', amount:2000, date:'2026-09-25', category:'Moradia', sourceType:'recurring', sourceId:'rent' },
    { id:'rec_salary_2026-09', type:'income', amount:7000, date:'2026-09-30', category:'Salário', sourceType:'recurring', sourceId:'salary' }
  ];
  const september = new Date(2026, 8, 1);
  const now = new Date(2026, 7, 19);
  assert.equal(projectedRecurringRows(transactions, recurring, september, now).length, 0);
  const metrics = monthMetrics(transactions, september, recurring, now);
  assert.equal(metrics.income, 7000);
  assert.equal(metrics.consumption, 2000);
  assert.equal(metrics.balance, 5000);
});

test('o cálculo de gasto não soma a definição recorrente por fora da transação materializada', () => {
  const recurring = [
    { id:'home', active:true, type:'expense', amount:2000, dayOfMonth:25, category:'Moradia', startDate:'2026-01-01', endDate:'' }
  ];
  const transactions = [
    { id:'rec_home_2026-08', type:'expense', amount:2000, date:'2026-08-25', category:'Moradia', sourceType:'recurring', sourceId:'home' }
  ];
  const spending = periodSpendingMetrics(transactions, recurring, new Date(2026, 7, 1), new Date(2026, 7, 19));
  assert.equal(spending.recurringExpenses, 2000);
  assert.equal(spending.totalExpenses, 2000);
});
