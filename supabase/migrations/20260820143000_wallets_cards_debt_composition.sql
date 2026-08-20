begin;

create table if not exists public.wallets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  institution text not null,
  name text not null,
  type text not null default 'checking',
  "initialBalance" numeric not null default 0,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint wallets_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint wallets_institution_valid check (char_length(institution) between 1 and 60),
  constraint wallets_name_valid check (char_length(name) between 1 and 60),
  constraint wallets_type_valid check (type in ('checking','savings','cash','digital','other')),
  constraint wallets_initial_balance_valid check ("initialBalance" > -1000000000 and "initialBalance" < 1000000000)
);

create table if not exists public.cards (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  institution text not null,
  name text not null,
  "creditLimit" numeric not null default 0,
  "closingDay" integer not null,
  "dueDay" integer not null,
  "paymentWalletId" text not null,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint cards_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint cards_institution_valid check (char_length(institution) between 1 and 60),
  constraint cards_name_valid check (char_length(name) between 1 and 60),
  constraint cards_limit_valid check ("creditLimit" >= 0 and "creditLimit" < 1000000000),
  constraint cards_closing_day_valid check ("closingDay" between 1 and 31),
  constraint cards_due_day_valid check ("dueDay" between 1 and 31),
  constraint cards_payment_wallet_fk foreign key (user_id, "paymentWalletId") references public.wallets(user_id, id) on delete restrict
);

alter table public.transactions
  add column if not exists "walletId" text,
  add column if not exists "cardId" text,
  add column if not exists "purchaseDate" text,
  add column if not exists "installmentGroupId" text,
  add column if not exists "installmentNumber" integer,
  add column if not exists "installmentTotal" integer;

alter table public.transactions
  add constraint transactions_wallet_fk foreign key (user_id, "walletId") references public.wallets(user_id, id) on delete restrict,
  add constraint transactions_card_fk foreign key (user_id, "cardId") references public.cards(user_id, id) on delete restrict,
  add constraint transactions_card_expense_only check ("cardId" is null or type = 'expense'),
  add constraint transactions_card_requires_wallet check ("cardId" is null or "walletId" is not null),
  add constraint transactions_purchase_date_valid check (
    "purchaseDate" is null
    or (case when pg_input_is_valid("purchaseDate", 'date') then ("purchaseDate"::date)::text = "purchaseDate" else false end)
  ),
  add constraint transactions_installment_group_valid check (
    "installmentGroupId" is null or "installmentGroupId" ~ '^[A-Za-z0-9_-]{1,160}$'
  ),
  add constraint transactions_installment_metadata_valid check (
    ("installmentGroupId" is null and "installmentNumber" is null and "installmentTotal" is null)
    or
    (
      "cardId" is not null
      and "installmentGroupId" is not null
      and "installmentNumber" between 1 and 120
      and "installmentTotal" between 1 and 120
      and "installmentNumber" <= "installmentTotal"
    )
  );

alter table public.recurring
  add column if not exists "walletId" text,
  add column if not exists "cardId" text;

alter table public.recurring
  add constraint recurring_wallet_fk foreign key (user_id, "walletId") references public.wallets(user_id, id) on delete restrict,
  add constraint recurring_card_fk foreign key (user_id, "cardId") references public.cards(user_id, id) on delete restrict,
  add constraint recurring_card_expense_only check ("cardId" is null or type = 'expense'),
  add constraint recurring_card_requires_wallet check ("cardId" is null or "walletId" is not null);

alter table public.scheduled
  add column if not exists "walletId" text,
  add column if not exists "cardId" text,
  add column if not exists "purchaseDate" text,
  add column if not exists "installmentGroupId" text,
  add column if not exists "installmentNumber" integer,
  add column if not exists "installmentTotal" integer;

alter table public.scheduled
  add constraint scheduled_wallet_fk foreign key (user_id, "walletId") references public.wallets(user_id, id) on delete restrict,
  add constraint scheduled_card_fk foreign key (user_id, "cardId") references public.cards(user_id, id) on delete restrict,
  add constraint scheduled_card_expense_only check ("cardId" is null or type = 'expense'),
  add constraint scheduled_card_requires_wallet check ("cardId" is null or "walletId" is not null),
  add constraint scheduled_purchase_date_valid check (
    "purchaseDate" is null
    or (case when pg_input_is_valid("purchaseDate", 'date') then ("purchaseDate"::date)::text = "purchaseDate" else false end)
  ),
  add constraint scheduled_installment_group_valid check (
    "installmentGroupId" is null or "installmentGroupId" ~ '^[A-Za-z0-9_-]{1,160}$'
  ),
  add constraint scheduled_installment_metadata_valid check (
    ("installmentGroupId" is null and "installmentNumber" is null and "installmentTotal" is null)
    or
    (
      "cardId" is not null
      and "purchaseDate" is not null
      and "installmentGroupId" is not null
      and "installmentNumber" between 1 and 120
      and "installmentTotal" between 1 and 120
      and "installmentNumber" <= "installmentTotal"
    )
  );

alter table public.positions
  add column if not exists "debtKind" text,
  add column if not exists institution text,
  add column if not exists "originalAmount" numeric,
  add column if not exists "installmentAmount" numeric,
  add column if not exists "totalInstallments" integer,
  add column if not exists "paidInstallments" integer,
  add column if not exists "interestRate" numeric,
  add column if not exists "dueDay" integer,
  add column if not exists notes text;

alter table public.positions
  add constraint positions_debt_kind_valid check ("debtKind" is null or "debtKind" in ('vehicle_financing','mortgage','installment','personal_loan','student_loan','other')),
  add constraint positions_debt_institution_valid check (institution is null or char_length(institution) <= 60),
  add constraint positions_original_amount_valid check ("originalAmount" is null or ("originalAmount" >= 0 and "originalAmount" < 1000000000)),
  add constraint positions_installment_amount_valid check ("installmentAmount" is null or ("installmentAmount" >= 0 and "installmentAmount" < 1000000000)),
  add constraint positions_total_installments_valid check ("totalInstallments" is null or "totalInstallments" between 1 and 1200),
  add constraint positions_paid_installments_valid check ("paidInstallments" is null or "paidInstallments" between 0 and 1200),
  add constraint positions_installment_progress_valid check ("totalInstallments" is null or "paidInstallments" is null or "paidInstallments" <= "totalInstallments"),
  add constraint positions_interest_rate_valid check ("interestRate" is null or "interestRate" between 0 and 100),
  add constraint positions_due_day_valid check ("dueDay" is null or "dueDay" between 1 and 31),
  add constraint positions_notes_valid check (notes is null or char_length(notes) <= 240),
  add constraint positions_debt_details_only check (
    type = 'debt'
    or ("debtKind" is null and institution is null and "originalAmount" is null and "installmentAmount" is null and "totalInstallments" is null and "paidInstallments" is null and "interestRate" is null and "dueDay" is null and notes is null)
  );

create index if not exists wallets_user_active_idx on public.wallets(user_id, active);
create index if not exists cards_user_active_idx on public.cards(user_id, active);
create index if not exists transactions_user_wallet_date_idx on public.transactions(user_id, "walletId", date);
create index if not exists transactions_user_card_date_idx on public.transactions(user_id, "cardId", date);
create index if not exists scheduled_user_card_due_idx on public.scheduled(user_id, "cardId", "dueDate") where status = 'active';
create index if not exists scheduled_user_installment_group_idx on public.scheduled(user_id, "installmentGroupId") where "installmentGroupId" is not null;

create or replace function private.mp_apply_source_routing()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  src record;
begin
  if new."sourceType" = 'scheduled' and new."sourceId" is not null then
    select "walletId", "cardId", "purchaseDate", "installmentGroupId", "installmentNumber", "installmentTotal"
      into src
      from public.scheduled
     where user_id = new.user_id and id = new."sourceId";
    if found then
      new."walletId" = src."walletId";
      new."cardId" = src."cardId";
      new."purchaseDate" = src."purchaseDate";
      new."installmentGroupId" = src."installmentGroupId";
      new."installmentNumber" = src."installmentNumber";
      new."installmentTotal" = src."installmentTotal";
    end if;
  elsif new."sourceType" = 'recurring' and new."sourceId" is not null then
    select "walletId", "cardId"
      into src
      from public.recurring
     where user_id = new.user_id and id = new."sourceId";
    if found then
      new."walletId" = src."walletId";
      new."cardId" = src."cardId";
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.mp_apply_source_routing() from public, anon, authenticated;

drop trigger if exists transactions_apply_source_routing on public.transactions;
create trigger transactions_apply_source_routing
before insert on public.transactions
for each row execute function private.mp_apply_source_routing();

drop trigger if exists wallets_set_timestamps on public.wallets;
create trigger wallets_set_timestamps before insert on public.wallets
for each row execute function private.mp_set_created_updated_at();
drop trigger if exists wallets_preserve_created_at on public.wallets;
create trigger wallets_preserve_created_at before update on public.wallets
for each row execute function private.mp_preserve_created_at();
drop trigger if exists wallets_touch_updated_at on public.wallets;
create trigger wallets_touch_updated_at before update on public.wallets
for each row execute function private.mp_touch_updated_at();

drop trigger if exists cards_set_timestamps on public.cards;
create trigger cards_set_timestamps before insert on public.cards
for each row execute function private.mp_set_created_updated_at();
drop trigger if exists cards_preserve_created_at on public.cards;
create trigger cards_preserve_created_at before update on public.cards
for each row execute function private.mp_preserve_created_at();
drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at before update on public.cards
for each row execute function private.mp_touch_updated_at();

alter table public.wallets enable row level security;
alter table public.wallets force row level security;
alter table public.cards enable row level security;
alter table public.cards force row level security;

revoke all on table public.wallets, public.cards from anon, authenticated;
grant select, insert, update, delete on table public.wallets, public.cards to authenticated;

create policy wallets_owner_only on public.wallets
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy cards_owner_only on public.cards
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy wallets_permanent_users_only on public.wallets
as restrictive for all
to authenticated
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

create policy cards_permanent_users_only on public.cards
as restrictive for all
to authenticated
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

commit;
