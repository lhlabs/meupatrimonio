import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contributionBalance, monthMetrics, walletMetrics } from '../finance-logic.js';

test('excluir visualmente um resgate não devolve o valor aos aportes', () => {
  const transactions = [
    { id:'aporte', type:'expense', amount:1000, category:'Investimentos/Aportes', date:'2026-08-01', walletId:'w1' },
    { id:'resgate', type:'income', amount:400, category:'Resgate de Patrimônio', date:'2026-08-20', walletId:null, archived:true }
  ];
  assert.equal(contributionBalance(transactions, '2026-08-20'), 600);
});

test('resgate arquivado deixa de afetar caixa, mas continua reduzindo o aporte líquido', () => {
  const wallets = [{ id:'w1', initialBalance:1000 }];
  const transactions = [
    { id:'aporte', type:'expense', amount:1000, category:'Investimentos/Aportes', date:'2026-08-01', walletId:'w1' },
    { id:'resgate', type:'income', amount:400, category:'Resgate de Patrimônio', date:'2026-08-20', walletId:'w1', archived:true }
  ];
  const metrics = monthMetrics(transactions, new Date(2026, 7, 1));
  assert.equal(metrics.withdrawal, 0);
  assert.equal(metrics.contribution, 600);
  assert.equal(walletMetrics(wallets, [], transactions, '2026-08-20').total, 0);
  assert.equal(contributionBalance(transactions, '2026-08-20'), 600);
});

test('novo aporte continua aumentando o patrimônio normalmente', () => {
  const transactions = [
    { type:'expense', amount:1000, category:'Investimentos/Aportes', date:'2026-08-01' },
    { type:'income', amount:400, category:'Resgate de Patrimônio', date:'2026-08-20', archived:true },
    { type:'expense', amount:250, category:'Investimentos/Aportes', date:'2026-08-21' }
  ];
  assert.equal(contributionBalance(transactions, '2026-08-21'), 850);
});

test('interface arquiva somente resgates e os remove das listagens', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const mobile = fs.readFileSync(new URL('../mobile/mobile.js', import.meta.url), 'utf8');
  assert.match(app, /isWithdrawal\(transaction\)[\s\S]*archived:true, walletId:null, cardId:null/);
  assert.match(app, /txCache\.filter\(tx => !isArchivedTransaction\(tx\)\)/);
  assert.match(mobile, /txCache\.filter\(tx => !isArchivedTransaction\(tx\)\)/);
});

test('migração adiciona apenas o marcador mínimo de arquivamento', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260820164500_archive_deleted_withdrawals.sql', import.meta.url), 'utf8');
  assert.match(migration, /add column if not exists archived boolean not null default false/i);
  assert.doesNotMatch(migration, /create table/i);
});
