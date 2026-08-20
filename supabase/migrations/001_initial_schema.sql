begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0 and amount < 100000000),
  category text not null,
  description text not null default '' check (char_length(description) <= 80),
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  recurring boolean not null default false,
  "sourceType" text,
  "sourceId" text,
  "createdAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint transactions_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint transactions_source_id_valid check ("sourceId" is null or "sourceId" ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint transactions_source_type_valid check ("sourceType" is null or "sourceType" in ('recurring','scheduled','contribution','withdrawal')),
  constraint transactions_category_valid check (
    (type = 'expense' and category in ('Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Academia','Investimentos/Aportes','Outros'))
    or
    (type = 'income' and category in ('Salário','Renda extra','Investimentos','Resgate de Patrimônio','Outros'))
  )
);

create table if not exists public.positions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  type text not null check (type in ('asset','reserve','debt')),
  name text not null check (char_length(name) between 1 and 60),
  value numeric not null check (value >= 0 and value < 1000000000),
  "createdAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint positions_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$')
);

create table if not exists public.planning (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "monthlyContributionGoal" numeric not null default 0 check ("monthlyContributionGoal" >= 0 and "monthlyContributionGoal" < 100000000),
  "monthlySurplusGoal" numeric not null default 0 check ("monthlySurplusGoal" >= 0 and "monthlySurplusGoal" < 100000000),
  "dailySpendGoal" numeric not null default 0 check ("dailySpendGoal" >= 0 and "dailySpendGoal" < 100000000),
  "financialFreedomMonthlyCost" numeric not null default 0 check ("financialFreedomMonthlyCost" >= 0 and "financialFreedomMonthlyCost" < 100000000),
  "realReturn" numeric not null default 5 check ("realReturn" between 0 and 20),
  "reserveTargetMonths" integer not null default 6 check ("reserveTargetMonths" between 1 and 24),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id)
);

create table if not exists public."monthlyGoals" (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  "month" text not null check ("month" ~ '^\d{4}-\d{2}$'),
  "contributionGoal" numeric not null default 0 check ("contributionGoal" >= 0 and "contributionGoal" < 100000000),
  "surplusGoal" numeric not null default 0 check ("surplusGoal" >= 0 and "surplusGoal" < 100000000),
  "dailySpendGoal" numeric not null default 0 check ("dailySpendGoal" >= 0 and "dailySpendGoal" < 100000000),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint monthly_goals_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$')
);

create table if not exists public.recurring (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0 and amount < 100000000),
  category text not null,
  day integer not null check (day between 1 and 31),
  "startDate" text not null check ("startDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  "endDate" text check ("endDate" is null or "endDate" = '' or "endDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint recurring_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint recurring_category_valid check (
    (type = 'expense' and category in ('Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Academia','Investimentos/Aportes','Outros'))
    or
    (type = 'income' and category in ('Salário','Renda extra','Investimentos','Resgate de Patrimônio','Outros'))
  )
);

create table if not exists public.scheduled (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0 and amount < 100000000),
  category text not null,
  "dueDate" text not null check ("dueDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  frequency text not null default 'once' check (frequency in ('once','annual')),
  status text not null default 'pending' check (status in ('pending','posted')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key (user_id, id),
  constraint scheduled_id_valid check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  constraint scheduled_category_valid check (
    (type = 'expense' and category in ('Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Academia','Investimentos/Aportes','Outros'))
    or
    (type = 'income' and category in ('Salário','Renda extra','Investimentos','Resgate de Patrimônio','Outros'))
  )
);

create index if not exists transactions_user_date_idx on public.transactions(user_id, date);
create index if not exists positions_user_type_idx on public.positions(user_id, type);
create index if not exists recurring_user_active_idx on public.recurring(user_id, active);
create index if not exists scheduled_user_due_date_idx on public.scheduled(user_id, "dueDate");
create index if not exists scheduled_user_status_idx on public.scheduled(user_id, status);

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

revoke execute on function private.mp_preserve_created_at() from public, anon, authenticated;
revoke execute on function private.mp_touch_updated_at() from public, anon, authenticated;

drop trigger if exists transactions_preserve_created_at on public.transactions;
create trigger transactions_preserve_created_at before update on public.transactions
for each row execute function private.mp_preserve_created_at();

drop trigger if exists positions_preserve_created_at on public.positions;
create trigger positions_preserve_created_at before update on public.positions
for each row execute function private.mp_preserve_created_at();

drop trigger if exists monthly_goals_preserve_created_at on public."monthlyGoals";
create trigger monthly_goals_preserve_created_at before update on public."monthlyGoals"
for each row execute function private.mp_preserve_created_at();

drop trigger if exists monthly_goals_touch_updated_at on public."monthlyGoals";
create trigger monthly_goals_touch_updated_at before update on public."monthlyGoals"
for each row execute function private.mp_touch_updated_at();

drop trigger if exists recurring_preserve_created_at on public.recurring;
create trigger recurring_preserve_created_at before update on public.recurring
for each row execute function private.mp_preserve_created_at();

drop trigger if exists recurring_touch_updated_at on public.recurring;
create trigger recurring_touch_updated_at before update on public.recurring
for each row execute function private.mp_touch_updated_at();

drop trigger if exists scheduled_preserve_created_at on public.scheduled;
create trigger scheduled_preserve_created_at before update on public.scheduled
for each row execute function private.mp_preserve_created_at();

drop trigger if exists scheduled_touch_updated_at on public.scheduled;
create trigger scheduled_touch_updated_at before update on public.scheduled
for each row execute function private.mp_touch_updated_at();

drop trigger if exists planning_touch_updated_at on public.planning;
create trigger planning_touch_updated_at before update on public.planning
for each row execute function private.mp_touch_updated_at();

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

-- Supabase concede privilégios padrão amplos em tabelas do schema public.
-- Revogamos primeiro de anon e authenticated; depois devolvemos somente CRUD.
-- RLS continua sendo a camada de autorização por linha, enquanto esta camada
-- impede operações estruturais como TRUNCATE que não são filtradas por RLS.
revoke all on table public.transactions, public.positions, public.planning, public."monthlyGoals", public.recurring, public.scheduled from anon, authenticated;
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
