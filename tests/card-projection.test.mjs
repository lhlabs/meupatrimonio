import test from 'node:test';
import assert from 'node:assert/strict';
import { monthMetrics, periodSpendingMetrics, projectedCardInstallmentRows, walletMetrics } from '../finance-logic.js';

const scheduled = [{
  id:'inst_g1_001', status:'active', type:'expense', amount:103, category:'Compras', description:'West Gun',
  dueDate:'2026-10-07', walletId:'w1', cardId:'c1', purchaseDate:'2026-09-07',
  installmentGroupId:'g1', installmentNumber:1, installmentTotal:6
}];

test('future card installment reduces projected monthly balance and expenses without lowering real wallet early', () => {
  const projected = projectedCardInstallmentRows([], scheduled, new Date(2026,9,1));
  assert.equal(projected.length,1);
  assert.equal(projected[0].projected,true);
  assert.equal(projected[0].cardId,'c1');

  const metrics = monthMetrics(projected,new Date(2026,9,1));
  const spending = periodSpendingMetrics(projected,[],new Date(2026,9,1),new Date(2026,7,20));
  assert.equal(metrics.consumption,103);
  assert.equal(metrics.balance,-103);
  assert.equal(spending.totalExpenses,103);

  const wallet = walletMetrics([{id:'w1',initialBalance:1000}],[],[], '2026-10-01');
  assert.equal(wallet.total,1000);
});

test('posted card installment replaces projection instead of duplicating monthly expense', () => {
  const transactions = [{
    id:'sched_inst_g1_001', type:'expense', amount:103, category:'Compras', description:'West Gun', date:'2026-10-07',
    sourceType:'scheduled', sourceId:'inst_g1_001', walletId:'w1', cardId:'c1', installmentGroupId:'g1', installmentNumber:1, installmentTotal:6
  }];
  assert.equal(projectedCardInstallmentRows(transactions,scheduled,new Date(2026,9,1)).length,0);
  const metrics = monthMetrics(transactions,new Date(2026,9,1));
  assert.equal(metrics.consumption,103);
  assert.equal(metrics.balance,-103);
});

test('card installment is projected only in its invoice due month', () => {
  assert.equal(projectedCardInstallmentRows([],scheduled,new Date(2026,8,1)).length,0);
  assert.equal(projectedCardInstallmentRows([],scheduled,new Date(2026,9,1)).length,1);
  assert.equal(projectedCardInstallmentRows([],scheduled,new Date(2026,10,1)).length,0);
});
