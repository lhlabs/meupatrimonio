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
