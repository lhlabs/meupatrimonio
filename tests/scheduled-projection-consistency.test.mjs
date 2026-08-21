import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTRIBUTION_CATEGORY,
  contributionBalance,
  monthMetrics,
  periodSpendingMetrics,
  walletMetrics
} from '../finance-logic.js';

const august = new Date(2026, 7, 1);

const transactions = [
  { id:'income', type:'income', amount:1000, category:'Salário', description:'Salário', date:'2026-08-01', walletId:'wallet' },
  { id:'expense', type:'expense', amount:100, category:'Mercado', description:'Mercado', date:'2026-08-02', walletId:'wallet' },
  { id:'scheduled', type:'expense', amount:300, category:'Impostos', description:'IPVA', date:'2026-08-30', walletId:'wallet', sourceType:'scheduled', sourceId:'ipva', projected:true },
  { id:'contribution', type:'expense', amount:50, category:CONTRIBUTION_CATEGORY, description:'Aporte', date:'2026-08-03', walletId:'wallet' },
  { id:'future-contribution', type:'expense', amount:200, category:CONTRIBUTION_CATEGORY, description:'Aporte agendado', date:'2026-08-28', walletId:'wallet', sourceType:'scheduled', sourceId:'aporte', projected:true }
];

test('modo realizado ignora compromissos ainda projetados', () => {
  const metrics = monthMetrics(transactions, august);
  assert.equal(metrics.income, 1000);
  assert.equal(metrics.consumption, 100);
  assert.equal(metrics.grossContribution, 50);
  assert.equal(metrics.balance, 850);
  assert.equal(metrics.rows.some(item => item.projected === true), false);
});

test('painel mensal inclui compromissos projetados sem convertê-los em realizados', () => {
  const metrics = monthMetrics(transactions, august, []);
  assert.equal(metrics.income, 1000);
  assert.equal(metrics.consumption, 400);
  assert.equal(metrics.grossContribution, 250);
  assert.equal(metrics.balance, 350);
  assert.equal(metrics.rows.filter(item => item.projected === true).length, 2);

  const spending = periodSpendingMetrics(transactions, [], august);
  assert.equal(spending.totalExpenses, 400);
  assert.equal(spending.otherExpenses, 400);
});

test('projeções não alteram saldo real de carteira nem patrimônio por aportes', () => {
  const wallet = walletMetrics([{ id:'wallet', initialBalance:0 }], [], transactions, '2026-08-31').byWallet[0];
  assert.equal(wallet.balance, 850);
  assert.equal(contributionBalance(transactions, '2026-08-31'), 50);
});

test('migração espelha somente agendamentos comuns e preserva parcelas no fluxo já existente', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260821110000_unify_scheduled_month_projection.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists projected boolean not null default false/i);
  assert.match(sql, /create trigger scheduled_projection_sync/i);
  assert.match(sql, /new\."installmentGroupId" is null/i);
  assert.match(sql, /s\."installmentGroupId" is null/i);
});
