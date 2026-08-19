import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlySpendingGoal, periodSpendingMetrics, scoreMetrics } from '../finance-logic.js';

test('gasto realizado do mês soma apenas lançamentos do mês e exclui aportes', () => {
  const tx = [
    { type:'income', amount:12840, date:'2026-08-01', category:'Salário' },
    { type:'expense', amount:4500, date:'2026-08-05', category:'Moradia', sourceType:'recurring' },
    { type:'expense', amount:1200, date:'2026-08-10', category:'Mercado' },
    { type:'expense', amount:3000, date:'2026-08-12', category:'Investimentos/Aportes' },
    { type:'expense', amount:900, date:'2026-09-01', category:'Mercado' }
  ];
  const result = periodSpendingMetrics(tx, [], new Date(2026, 7, 1));
  assert.equal(result.recurringExpenses, 4500);
  assert.equal(result.otherExpenses, 1200);
  assert.equal(result.totalExpenses, 5700);
  assert.equal(monthlySpendingGoal(12840), 7704);
});

test('recorrência cadastrada mas ainda não realizada não infla gasto realizado', () => {
  const tx = [
    { type:'expense', amount:1500, date:'2026-08-05', category:'Moradia', sourceType:'recurring' },
    { type:'expense', amount:600, date:'2026-08-08', category:'Mercado' }
  ];
  const recurring = [
    { active:true, type:'expense', amount:5000, category:'Veículo', startDate:'2026-01-01', endDate:'', dayOfMonth:25 }
  ];
  const result = periodSpendingMetrics(tx, recurring, new Date(2026, 7, 1));
  assert.equal(result.totalExpenses, 2100);
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
