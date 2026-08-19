import test from 'node:test';
import assert from 'node:assert/strict';
import { periodSpendingMetrics, recurringDue, reserveMetrics, shouldMaterializeRecurring } from '../finance-logic.js';

test('reserva considera recorrência ativa do mês mesmo se o vencimento antecede a data de início', () => {
  const recurring = [
    { active:true, type:'expense', amount:1200, dayOfMonth:5, category:'Moradia', startDate:'2026-08-10', endDate:'' },
    { active:true, type:'expense', amount:800, dayOfMonth:20, category:'Veículo', startDate:'2026-01-01', endDate:'' }
  ];
  const result = reserveMetrics({
    reserve:20000,
    transactions:[],
    recurring,
    todayYmd:'2026-08-19',
    targetMonths:6
  });
  assert.equal(result.monthlyBase, 2000);
  assert.equal(result.target, 12000);
  assert.equal(result.months, 10);
  assert.equal(result.progress, 1);
});

test('recorrência do mês é materializada antes do vencimento, mas mês futuro não é', () => {
  assert.equal(shouldMaterializeRecurring('2026-08-25', '2026-08-19'), true);
  assert.equal(shouldMaterializeRecurring('2026-08-31', '2026-08-01'), true);
  assert.equal(shouldMaterializeRecurring('2026-09-01', '2026-08-19'), false);
});

test('lançamentos recorrentes materializados compõem o gasto do mês sem cálculo paralelo', () => {
  const recurring = [
    { active:true, type:'expense', amount:1200, dayOfMonth:5, category:'Moradia', startDate:'2026-08-10', endDate:'' },
    { active:true, type:'expense', amount:800, dayOfMonth:20, category:'Veículo', startDate:'2026-01-01', endDate:'' }
  ];
  const transactions = [
    { type:'expense', amount:1200, date:'2026-08-10', category:'Moradia', recurring:true },
    { type:'expense', amount:800, date:'2026-08-20', category:'Veículo', sourceType:'recurring' }
  ];
  const spending = periodSpendingMetrics(transactions, recurring, new Date(2026,7,1), new Date(2026,7,19));
  assert.equal(spending.recurringExpenses, 2000);
  assert.equal(spending.otherExpenses, 0);
  assert.equal(spending.totalExpenses, 2000);
});

test('lançamento manual que originou recorrência não é contado duas vezes no mês inicial', () => {
  const transactions = [
    { id:'seed123', type:'expense', amount:900, date:'2026-08-10', category:'Moradia', recurring:true },
    { id:'other', type:'expense', amount:300, date:'2026-08-11', category:'Mercado', recurring:false }
  ];
  const recurring = [{
    id:'legacy_seed123',
    active:true,
    type:'expense',
    amount:900,
    dayOfMonth:10,
    category:'Moradia',
    startDate:'2026-08-10',
    endDate:''
  }];
  const spending = periodSpendingMetrics(transactions, recurring, new Date(2026,7,1), new Date(2026,7,19));
  assert.equal(spending.recurringExpenses, 900);
  assert.equal(spending.otherExpenses, 300);
  assert.equal(spending.totalExpenses, 1200);
});

test('recorrência criada a partir de lançamento manual não duplica o mês inicial no automatismo', () => {
  const legacy = {
    id:'legacy_seed123',
    active:true,
    type:'expense',
    amount:900,
    dayOfMonth:10,
    category:'Moradia',
    startDate:'2026-08-10',
    endDate:''
  };
  assert.equal(recurringDue(legacy, new Date(2026,7,1)), null);
  assert.equal(recurringDue(legacy, new Date(2026,8,1)), '2026-09-10');
});
