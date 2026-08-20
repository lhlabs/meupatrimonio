import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('automações preservam roteamento financeiro ao materializar lançamentos', () => {
  assert.match(appSource, /walletId: recurring\.walletId \|\| null/);
  assert.match(appSource, /walletId: scheduled\.walletId \|\| null/);
  assert.match(appSource, /cardId: scheduled\.cardId \|\| null/);
  assert.match(appSource, /installmentGroupId: scheduled\.installmentGroupId \|\| null/);
  assert.match(appSource, /installmentNumber: scheduled\.installmentNumber \?\? null/);
  assert.match(appSource, /installmentTotal: scheduled\.installmentTotal \?\? null/);
});

test('dados antigos de automações recebem reparo de metadados', () => {
  assert.match(appSource, /async function repairAutomationRoutingMetadata\(\)/);
  assert.match(appSource, /const routingRepaired = await repairAutomationRoutingMetadata\(\)/);
});

test('recorrência não é exibida junto ao parcelamento do cartão', () => {
  assert.match(appSource, /recurringLabel\.style\.display = editing \|\| cardMode \? 'none' : ''/);
});

test('virada de data sincroniza o mês e reprocessa automações sem exigir recarga manual', () => {
  assert.match(appSource, /async function synchronizeDateRollover\(\)/);
  assert.match(appSource, /window\.addEventListener\('focus', \(\) => void synchronizeDateRollover\(\)\)/);
  assert.match(appSource, /visibilitychange/);
  assert.match(appSource, /setInterval\(\(\) => void synchronizeDateRollover\(\), 60_000\)/);
});

test('recorrências legadas recebem carteira única sem rebaixar movimentos anteriores à criação da carteira', () => {
  assert.match(appSource, /async function repairRecurringWalletAssignments\(\)/);
  assert.match(appSource, /activeWallets\.length !== 1/);
  assert.match(appSource, /dueCanUseWallet\(source, tx\.date\)/);
  assert.match(appSource, /dueCanUseWallet\(recurring, due\)/);
  assert.match(appSource, /walletId: tx\.walletId \|\| null/);
});
