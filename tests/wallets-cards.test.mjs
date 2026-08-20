import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDebtMetrics, cardInstallmentSchedule, positionMetrics, splitInstallmentAmounts, walletMetrics } from '../finance-logic.js';

test('parcelamento divide centavos sem alterar o total', () => {
  const parts = splitInstallmentAmounts(100, 3);
  assert.deepEqual(parts, [33.34,33.33,33.33]);
  assert.equal(Math.round(parts.reduce((a,b)=>a+b,0)*100), 10000);
});

test('vencimento respeita fechamento do cartão', () => {
  const before = cardInstallmentSchedule({ amount:1200, installments:3, purchaseDate:'2026-08-04', closingDay:5, dueDay:12 });
  assert.deepEqual(before.map(item=>item.date), ['2026-08-12','2026-09-12','2026-10-12']);
  const after = cardInstallmentSchedule({ amount:1200, installments:3, purchaseDate:'2026-08-06', closingDay:5, dueDay:12 });
  assert.deepEqual(after.map(item=>item.date), ['2026-09-12','2026-10-12','2026-11-12']);
});

test('saldo da carteira deriva do saldo inicial e dos lançamentos vinculados', () => {
  const wallets = [{id:'w1',initialBalance:1000}];
  const tx = [
    {walletId:'w1',type:'income',amount:500,date:'2026-08-01'},
    {walletId:'w1',type:'expense',amount:250,date:'2026-08-02'},
    {walletId:'w1',type:'expense',amount:100,date:'2026-09-01'}
  ];
  assert.equal(walletMetrics(wallets,[],tx,'2026-08-20').total,1250);
});

test('parcelas futuras permanecem como dívida de cartão até o vencimento', () => {
  const cards = [{id:'c1',creditLimit:5000}];
  const scheduled = [
    {cardId:'c1',status:'active',amount:300,dueDate:'2026-09-10',purchaseDate:'2026-08-10'},
    {cardId:'c1',status:'active',amount:300,dueDate:'2026-10-10',purchaseDate:'2026-08-10'},
    {cardId:'c1',status:'posted',amount:300,dueDate:'2026-08-10',purchaseDate:'2026-08-10'}
  ];
  const metric = cardDebtMetrics(cards,[],scheduled,'2026-08-20');
  assert.equal(metric.total,600);
  assert.equal(metric.byCard[0].availableLimit,4400);
});

test('patrimônio integra carteiras e cartão sem saldo duplicado', () => {
  const positions = [{type:'asset',value:10000},{type:'debt',value:2000}];
  const wallets = [{id:'w1',initialBalance:5000}];
  const cards = [{id:'c1',creditLimit:5000}];
  const tx = [{walletId:'w1',type:'expense',amount:1000,date:'2026-08-10'}];
  const scheduled = [{cardId:'c1',walletId:'w1',status:'active',amount:600,dueDate:'2026-09-10',purchaseDate:'2026-08-10'}];
  const metric = positionMetrics(positions,tx,'2026-08-20',wallets,cards,scheduled);
  assert.equal(metric.walletAssets,4000);
  assert.equal(metric.cardDebts,600);
  assert.equal(metric.debts,2600);
  assert.equal(metric.netWorth,11400);
});


test('compra no dia do fechamento entra na fatura seguinte', () => {
  const schedule = cardInstallmentSchedule({ amount:100, installments:1, purchaseDate:'2026-08-05', closingDay:5, dueDay:12 });
  assert.deepEqual(schedule.map(item => item.date), ['2026-09-12']);
});

test('parcelamento legado sem status ainda compõe o valor em aberto', () => {
  const metric = cardDebtMetrics([{id:'c1',creditLimit:1000}],[],[{cardId:'c1',amount:250,dueDate:'2026-09-12',purchaseDate:'2026-08-10'}],'2026-08-20');
  assert.equal(metric.total,250);
  assert.equal(metric.byCard[0].availableLimit,750);
});

test('pagamento de parcela reduz caixa e dívida na mesma quantia sem alterar patrimônio líquido', () => {
  const wallets = [{id:'w1',initialBalance:1000}];
  const cards = [{id:'c1',creditLimit:5000}];
  const before = positionMetrics([],[],'2026-08-20',wallets,cards,[
    {cardId:'c1',walletId:'w1',status:'active',amount:300,dueDate:'2026-08-20',purchaseDate:'2026-08-10'},
    {cardId:'c1',walletId:'w1',status:'active',amount:300,dueDate:'2026-09-20',purchaseDate:'2026-08-10'}
  ]);
  const after = positionMetrics([],[
    {walletId:'w1',cardId:'c1',type:'expense',amount:300,date:'2026-08-20'}
  ],'2026-08-20',wallets,cards,[
    {cardId:'c1',walletId:'w1',status:'posted',amount:300,dueDate:'2026-08-20',purchaseDate:'2026-08-10'},
    {cardId:'c1',walletId:'w1',status:'active',amount:300,dueDate:'2026-09-20',purchaseDate:'2026-08-10'}
  ]);
  assert.equal(before.netWorth,400);
  assert.equal(after.netWorth,400);
  assert.equal(after.walletAssets,700);
  assert.equal(after.cardDebts,300);
});
