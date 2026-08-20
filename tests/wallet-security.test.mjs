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
  assert.match(sql,/foreign key \(user_id, "paymentWalletId"\) references public\.wallets\(user_id, id\)/i);
  assert.match(sql,/transactions_wallet_fk foreign key \(user_id, "walletId"\) references public\.wallets\(user_id, id\)/i);
  assert.match(sql,/transactions_card_fk foreign key \(user_id, "cardId"\) references public\.cards\(user_id, id\)/i);
  assert.match(sql,/scheduled_wallet_fk foreign key \(user_id, "walletId"\) references public\.wallets\(user_id, id\)/i);
  assert.match(sql,/scheduled_card_fk foreign key \(user_id, "cardId"\) references public\.cards\(user_id, id\)/i);
});

test('cartões e parcelamentos exigem rota de pagamento e metadados íntegros', () => {
  for (const constraint of [
    'transactions_card_requires_wallet', 'transactions_installment_metadata_valid',
    'recurring_card_requires_wallet',
    'scheduled_card_requires_wallet', 'scheduled_installment_metadata_valid'
  ]) assert.ok(sql.includes(constraint), `constraint ausente: ${constraint}`);
  assert.doesNotMatch(sql, /route_exclusive/);
  assert.match(sql, /"installmentNumber" <= "installmentTotal"/);
  assert.match(sql, /"purchaseDate" is not null/);
});
