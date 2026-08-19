import test from 'node:test';
import assert from 'node:assert/strict';
import { periodSpendingMetrics, recurringDue, reserveMetrics } from '../finance-logic.js';

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

test('gastos do mês corrente usam todas as recorrências ativas como compromisso do período', () => {
  const recurring = [
    { active:true, type:'expense', amount:1200, dayOfMonth:5, category:'Moradia', startDate:'2026-08-10', endDate:'' },
    { active:true, type:'expense', amount:800, dayOfMonth:20, category:'Veículo', startDate:'2026-01-01', endDate:'' }
  ];
  const result = periodSpendingMetrics([], recurring, new Date(2026,7,1), new Date(2026,7,19));
  assert.equal(result.recurringExpenses, 2000);
  assert.equal(result.otherExpenses, 0);
  assert.equal(result.totalExpenses, 2000);
});

test('recorrência criada a partir de lançamento manual não duplica o mês inicial', () => {
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
