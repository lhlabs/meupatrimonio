import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('lançamento materializado de agendamento permanece editável', () => {
  assert.match(app, /tx\.sourceType === 'scheduled'[\s\S]{0,180}data-edit-tx/);
  assert.match(app, /tx\.sourceType === 'recurring' \|\| tx\.projected \|\| isWithdrawal\(tx\)/);
  assert.doesNotMatch(app, /if \(tx && \(tx\.sourceType \|\| isWithdrawal\(tx\)\)\) return/);
});

test('agenda lançada aponta para a transação efetivamente materializada', () => {
  assert.match(app, /function latestScheduledTransaction\(sourceId\)/);
  assert.match(app, /item\.status === 'posted' \? latestScheduledTransaction\(item\.id\) : null/);
  assert.ok(app.includes('data-edit-tx="${postedTx.id}">Editar lançamento'));
});

test('agendamentos usam um único gerador de id em materialização e previsão', () => {
  assert.match(app, /function scheduledTransactionId\(scheduled, due\)/);
  const uses = app.match(/scheduledTransactionId\(scheduled, due\)/g) || [];
  assert.ok(uses.length >= 3, `esperados definição + 2 usos; encontrados ${uses.length}`);
});

test('edição da ocorrência preserva vínculo com agendamento e permite carteira', () => {
  const update = app.match(/updateDoc\(userDoc\('transactions', id\), \{[^}]+\}\)/)?.[0] || '';
  assert.match(update, /type, amount, category, description, date, walletId, cardId:null/);
  assert.doesNotMatch(update, /sourceType|sourceId/);
  assert.match(app, /sourceType: 'scheduled',[\s\S]{0,80}sourceId: scheduled\.id/);
});
