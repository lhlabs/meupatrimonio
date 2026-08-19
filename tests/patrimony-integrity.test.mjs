import test from 'node:test';
import assert from 'node:assert/strict';
import { positionMetrics } from '../finance-logic.js';

test('patrimônio atual soma posições manuais e aportes realizados, descontando resgates', () => {
  const positions = [
    { type: 'asset', value: 10000 },
    { type: 'reserve', value: 20000 },
    { type: 'debt', value: 5000 }
  ];
  const transactions = [
    { type: 'expense', amount: 1000, date: '2026-08-01', category: 'Investimentos/Aportes' },
    { type: 'expense', amount: 500, date: '2026-08-19', category: 'Investimentos/Aportes' },
    { type: 'income', amount: 300, date: '2026-08-19', category: 'Resgate de Patrimônio' }
  ];

  const result = positionMetrics(positions, transactions, '2026-08-19');
  assert.equal(result.manualAssets, 30000);
  assert.equal(result.manualReserve, 20000);
  assert.equal(result.contributionAssets, 1200);
  assert.equal(result.assets, 31200);
  assert.equal(result.reserve, 21200);
  assert.equal(result.debts, 5000);
  assert.equal(result.netWorth, 26200);
});

test('aporte aumenta a reserva sem duplicar o patrimônio total', () => {
  const positions = [{ type: 'reserve', value: 5000 }];
  const transactions = [
    { type: 'expense', amount: 2000, date: '2026-08-10', category: 'Investimentos/Aportes' }
  ];
  const result = positionMetrics(positions, transactions, '2026-08-19');
  assert.equal(result.manualReserve, 5000);
  assert.equal(result.contributionAssets, 2000);
  assert.equal(result.reserve, 7000);
  assert.equal(result.assets, 7000);
  assert.equal(result.netWorth, 7000);
});

test('resgate reduz simultaneamente patrimônio por aportes e reserva composta', () => {
  const positions = [{ type: 'reserve', value: 5000 }];
  const transactions = [
    { type: 'expense', amount: 2000, date: '2026-08-10', category: 'Investimentos/Aportes' },
    { type: 'income', amount: 750, date: '2026-08-15', category: 'Resgate de Patrimônio' }
  ];
  const result = positionMetrics(positions, transactions, '2026-08-19');
  assert.equal(result.contributionAssets, 1250);
  assert.equal(result.reserve, 6250);
  assert.equal(result.netWorth, 6250);
});

test('aporte com data futura não infla patrimônio nem reserva atuais', () => {
  const transactions = [
    { type: 'expense', amount: 1000, date: '2026-08-18', category: 'Investimentos/Aportes' },
    { type: 'expense', amount: 9000, date: '2026-09-01', category: 'Investimentos/Aportes' }
  ];

  const current = positionMetrics([], transactions, '2026-08-19');
  const future = positionMetrics([], transactions, '2026-09-01');
  assert.equal(current.contributionAssets, 1000);
  assert.equal(current.reserve, 1000);
  assert.equal(current.netWorth, 1000);
  assert.equal(future.contributionAssets, 10000);
  assert.equal(future.reserve, 10000);
});

test('exclusão de um aporte é refletida diretamente no patrimônio consolidado e na reserva', () => {
  const transactions = [
    { id: 'a', type: 'expense', amount: 1000, date: '2026-08-01', category: 'Investimentos/Aportes' },
    { id: 'b', type: 'expense', amount: 750, date: '2026-08-10', category: 'Investimentos/Aportes' }
  ];

  const before = positionMetrics([], transactions, '2026-08-19');
  const after = positionMetrics([], transactions.filter(item => item.id !== 'b'), '2026-08-19');
  assert.equal(before.netWorth, 1750);
  assert.equal(before.reserve, 1750);
  assert.equal(after.netWorth, 1000);
  assert.equal(after.reserve, 1000);
});
