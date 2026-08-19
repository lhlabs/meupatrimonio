begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  type text not null,
  amount numeric not null,
  category text not null,
  description text not null,
  "date" text not null,
  recurring boolean not null default false,
  "sourceType" text,
  "sourceId" text,
  "createdAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint transactions_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint transactions_type_valid check (type in ('income','expense')),
  constraint transactions_amount_valid check (amount > 0 and amount < 100000000),
  constraint transactions_date_valid check ("date" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint transactions_description_valid check (char_length(description) <= 80),
  constraint transactions_source_type_valid check ("sourceType" is null or "sourceType" in ('recurring','scheduled')),
  constraint transactions_source_id_valid check ("sourceId" is null or char_length("sourceId") <= 128),
  constraint transactions_category_valid check (
    (type = 'expense' and category in (
      'Moradia','Mercado','Restaurantes','Transporte','Veículo','Saúde','Academia','Pets',
      'Assinaturas','Lazer','Compras','Impostos','Seguros','Educação','Viagens',
      'Investimentos/Aportes','Outros'
    ))
    or
    (type = 'income' and category in (
      'Salário','Benefícios','Renda extra','Investimentos','Reembolso','Venda','Outros','Resgate de Patrimônio'
    ))
  )
);

create table if not exists public.positions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  type text not null,
  name text not null,
  value numeric not null,
  "createdAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint positions_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint positions_type_valid check (type in ('asset','reserve','debt')),
  constraint positions_name_valid check (char_length(name) between 1 and 60),
  constraint positions_value_valid check (value >= 0 and value < 1000000000)
);

create table if not exists public.planning (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  "monthlyContributionGoal" numeric not null default 0,
  "monthlySurplusGoal" numeric not null default 0,
  "dailySpendGoal" numeric not null default 0,
  "financialFreedomMonthlyCost" numeric not null default 0,
  "realReturn" numeric not null default 5,
  "reserveTargetMonths" integer not null default 6,
  "updatedAt" timestamptz not null default now(),
  constraint planning_contribution_valid check ("monthlyContributionGoal" >= 0 and "monthlyContributionGoal" < 1000000000),
  constraint planning_surplus_valid check ("monthlySurplusGoal" >= 0 and "monthlySurplusGoal" < 1000000000),
  constraint planning_spend_valid check ("dailySpendGoal" >= 0 and "dailySpendGoal" < 1000000000),
  constraint planning_freedom_valid check ("financialFreedomMonthlyCost" >= 0 and "financialFreedomMonthlyCost" < 1000000000),
  constraint planning_return_valid check ("realReturn" >= 0 and "realReturn" <= 20),
  constraint planning_reserve_months_valid check ("reserveTargetMonths" between 1 and 24)
);

create table if not exists public."monthlyGoals" (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  month text not null,
  "monthlySurplusGoal" numeric not null default 0,
  "dailySpendGoal" numeric not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint monthly_goals_id_valid check (id ~ '^\d{4}-\d{2}$'),
  constraint monthly_goals_month_valid check (month ~ '^\d{4}-\d{2}$'),
  constraint monthly_goals_id_matches_month check (id = month),
  constraint monthly_goals_surplus_valid check ("monthlySurplusGoal" >= 0 and "monthlySurplusGoal" < 1000000000),
  constraint monthly_goals_spend_valid check ("dailySpendGoal" >= 0 and "dailySpendGoal" < 1000000000)
);

create table if not exists public.recurring (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null,
  type text not null,
  amount numeric not null,
  category text not null,
  description text not null,
  "dayOfMonth" integer not null,
  "startDate" text not null,
  "endDate" text not null default '',
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint recurring_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint recurring_name_valid check (char_length(name) between 1 and 60),
  constraint recurring_type_valid check (type in ('income','expense')),
  constraint recurring_amount_valid check (amount > 0 and amount < 100000000),
  constraint recurring_description_valid check (char_length(description) <= 80),
  constraint recurring_day_valid check ("dayOfMonth" between 1 and 31),
  constraint recurring_start_date_valid check ("startDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint recurring_end_date_valid check ("endDate" = '' or "endDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint recurring_category_valid check (
    (type = 'expense' and category in (
      'Moradia','Mercado','Restaurantes','Transporte','Veículo','Saúde','Academia','Pets',
      'Assinaturas','Lazer','Compras','Impostos','Seguros','Educação','Viagens',
      'Investimentos/Aportes','Outros'
    ))
    or
    (type = 'income' and category in (
      'Salário','Benefícios','Renda extra','Investimentos','Reembolso','Venda','Outros'
    ))
  )
);

create table if not exists public.scheduled (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null,
  type text not null,
  amount numeric not null,
  category text not null,
  description text not null,
  "dueDate" text not null,
  frequency text not null,
  status text not null default 'active',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint scheduled_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint scheduled_name_valid check (char_length(name) between 1 and 60),
  constraint scheduled_type_valid check (type in ('income','expense')),
  constraint scheduled_amount_valid check (amount > 0 and amount < 100000000),
  constraint scheduled_description_valid check (char_length(description) <= 80),
  constraint scheduled_due_date_valid check ("dueDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint scheduled_frequency_valid check (frequency in ('once','annual')),
  constraint scheduled_status_valid check (status in ('active','posted','cancelled')),
  constraint scheduled_category_valid check (
    (type = 'expense' and category in (
      'Moradia','Mercado','Restaurantes','Transporte','Veículo','Saúde','Academia','Pets',
      'Assinaturas','Lazer','Compras','Impostos','Seguros','Educação','Viagens',
      'Investimentos/Aportes','Outros'
    ))
    or
    (type = 'income' and category in (
      'Salário','Benefícios','Renda extra','Investimentos','Reembolso','Venda','Outros'
    ))
  )
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, "date");
create index if not exists positions_user_type_idx on public.positions (user_id, type);
create index if not exists recurring_user_active_idx on public.recurring (user_id, active);
create index if not exists scheduled_user_due_date_idx on public.scheduled (user_id, "dueDate");
create index if not exists scheduled_user_status_idx on public.scheduled (user_id, status);

create or replace function private.mp_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

create or replace function private.mp_preserve_created_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new."createdAt" = old."createdAt";
  return new;
end;
$$;

revoke execute on function private.mp_touch_updated_at() from public, anon, authenticated;
revoke execute on function private.mp_preserve_created_at() from public, anon, authenticated;

drop trigger if exists planning_touch_updated_at on public.planning;
create trigger planning_touch_updated_at before update on public.planning
for each row execute function private.mp_touch_updated_at();

drop trigger if exists monthly_goals_touch_updated_at on public."monthlyGoals";
create trigger monthly_goals_touch_updated_at before update on public."monthlyGoals"
for each row execute function private.mp_touch_updated_at();

drop trigger if exists recurring_touch_updated_at on public.recurring;
create trigger recurring_touch_updated_at before update on public.recurring
for each row execute function private.mp_touch_updated_at();

drop trigger if exists scheduled_touch_updated_at on public.scheduled;
create trigger scheduled_touch_updated_at before update on public.scheduled
for each row execute function private.mp_touch_updated_at();

drop trigger if exists transactions_preserve_created_at on public.transactions;
create trigger transactions_preserve_created_at before update on public.transactions
for each row execute function private.mp_preserve_created_at();

drop trigger if exists positions_preserve_created_at on public.positions;
create trigger positions_preserve_created_at before update on public.positions
for each row execute function private.mp_preserve_created_at();

drop trigger if exists monthly_goals_preserve_created_at on public."monthlyGoals";
create trigger monthly_goals_preserve_created_at before update on public."monthlyGoals"
for each row execute function private.mp_preserve_created_at();

drop trigger if exists recurring_preserve_created_at on public.recurring;
create trigger recurring_preserve_created_at before update on public.recurring
for each row execute function private.mp_preserve_created_at();

drop trigger if exists scheduled_preserve_created_at on public.scheduled;
create trigger scheduled_preserve_created_at before update on public.scheduled
for each row execute function private.mp_preserve_created_at();

alter table public.transactions enable row level security;
alter table public.positions enable row level security;
alter table public.planning enable row level security;
alter table public."monthlyGoals" enable row level security;
alter table public.recurring enable row level security;
alter table public.scheduled enable row level security;

alter table public.transactions force row level security;
alter table public.positions force row level security;
alter table public.planning force row level security;
alter table public."monthlyGoals" force row level security;
alter table public.recurring force row level security;
alter table public.scheduled force row level security;

revoke all on table public.transactions, public.positions, public.planning, public."monthlyGoals", public.recurring, public.scheduled from anon;
grant select, insert, update, delete on table public.transactions, public.positions, public.planning, public."monthlyGoals", public.recurring, public.scheduled to authenticated;

create policy transactions_owner_only on public.transactions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy positions_owner_only on public.positions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy planning_owner_only on public.planning
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy monthly_goals_owner_only on public."monthlyGoals"
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy recurring_owner_only on public.recurring
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy scheduled_owner_only on public.scheduled
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
