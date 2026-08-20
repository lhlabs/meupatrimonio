import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260820143000_wallets_cards_debt_composition.sql', import.meta.url), 'utf8');

test('novas tabelas mantêm RLS forçado e isolamento por usuário', () => {
  for (const table of ['wallets','cards']) {
    assert.match(sql, new RegExp('alter table public\\.' + table + ' force row level security','i'));
    assert.match(sql, new RegExp('create policy ' + table + '_owner_only','i'));
    assert.match(sql, new RegExp('create policy ' + table + '_permanent_users_only','i'));
  }
  assert.match(sql,/grant select, insert, update, delete on table public\.wallets, public\.cards to authenticated/i);
  assert.doesNotMatch(sql,/grant .* to anon/i);
});

test('vínculos financeiros usam chaves compostas do mesmo usuário', () => {
  assert.match(sql,/foreign key (user_id, "paymentWalletId") references public\.wallets(user_id, id)/i);
  assert.match(sql,/transactions_wallet_fk foreign key (user_id, "walletId")/i);
  assert.match(sql,/transactions_card_fk foreign key (user_id, "cardId")/i);
  assert.match(sql,/scheduled_card_requires_wallet/i);
});
