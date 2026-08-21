create index if not exists cards_payment_wallet_fk_idx
  on public.cards (user_id, "paymentWalletId");

create index if not exists recurring_wallet_fk_idx
  on public.recurring (user_id, "walletId");

create index if not exists recurring_card_fk_idx
  on public.recurring (user_id, "cardId");

create index if not exists scheduled_wallet_fk_idx
  on public.scheduled (user_id, "walletId");
