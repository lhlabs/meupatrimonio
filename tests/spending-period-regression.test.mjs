import test from 'node:test';
import assert from 'node:assert/strict';
import { monthMetrics, monthlySpendingGoal, periodSpendingMetrics, scoreMetrics } from '../finance-logic.js';

test('gasto mensal soma lançamentos recorrentes do mês e exclui aportes', () => {
  const tx = [
    { type:'income', amount:12840, date:'2026-08-01', category:'Salário' },
    { type:'expense', amount:4500, date:'2026-08-05', category:'Moradia', sourceType:'recurring' },
    { type:'expense', amount:700, date:'2026-08-25', category:'Seguro', sourceType:'recurring' },
    { type:'expense', amount:1200, date:'2026-08-10', category:'Mercado' },
    { type:'expense', amount:3000, date:'2026-08-12', category:'Investimentos/Aportes' },
    { type:'expense', amount:900, date:'2026-09-01', category:'Mercado' }
  ];
  const result = periodSpendingMetrics(tx, [], new Date(2026, 7, 1), new Date(2026, 7, 19));
  assert.equal(result.recurringExpenses, 5200);
  assert.equal(result.otherExpenses, 1200);
  assert.equal(result.totalExpenses, 6400);
  assert.equal(monthlySpendingGoal(12840), 7704);
});

test('recorrência futura dentro do mês já compõe o gasto porque foi materializada', () => {
  const tx = [
    { type:'expense', amount:1500, date:'2026-08-05', category:'Moradia', sourceType:'recurring' },
    { type:'expense', amount:5000, date:'2026-08-25', category:'Veículo', sourceType:'recurring' },
    { type:'expense', amount:600, date:'2026-08-08', category:'Mercado' }
  ];
  const result = periodSpendingMetrics(tx, [], new Date(2026, 7, 1), new Date(2026, 7, 19));
  assert.equal(result.recurringExpenses, 6500);
  assert.equal(result.otherExpenses, 600);
  assert.equal(result.totalExpenses, 7100);
});

test('receita recorrente antecipada já compõe renda, saldo e meta de 60%', () => {
  const tx = [
    { type:'income', amount:3000, date:'2026-08-01', category:'Renda extra' },
    { type:'income', amount:7000, date:'2026-08-30', category:'Salário', sourceType:'recurring' },
    { type:'expense', amount:2000, date:'2026-08-25', category:'Moradia', sourceType:'recurring' }
  ];
  const metrics = monthMetrics(tx, new Date(2026,7,1));
  assert.equal(metrics.income, 10000);
  assert.equal(monthlySpendingGoal(metrics.income), 6000);
  assert.equal(metrics.consumption, 2000);
  assert.equal(metrics.balance, 8000);
});

test('cofrinho não pode ficar saudável quando gasto supera a meta mensal', () => {
  const score = scoreMetrics({
    contribution: 5000,
    contributionGoal: 1000,
    spending: 9000,
    spendingGoal: 7704,
    reserveProgress: 1
  });
  assert.ok(score.score <= 69);
});

test('estouro severo de gasto derruba saúde para faixa crítica', () => {
  const score = scoreMetrics({
    contribution: 5000,
    contributionGoal: 1000,
    spending: 15078,
    spendingGoal: 7704,
    reserveProgress: 1
  });
  assert.ok(score.score <= 49);
  assert.equal(score.spendingScore < 0.1, true);
});
