begin;

-- Para operações normais do PWA, timestamps são sempre definidos pelo banco.
-- Em migrações administrativas executadas sem auth.uid() (service role/SQL),
-- valores históricos podem ser preservados quando fornecidos explicitamente.

create or replace function private.mp_set_created_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null or new."createdAt" is null then
    new."createdAt" = now();
  end if;
  return new;
end;
$$;

create or replace function private.mp_set_created_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null or new."createdAt" is null then
    new."createdAt" = now();
  end if;
  if auth.uid() is not null or new."updatedAt" is null then
    new."updatedAt" = now();
  end if;
  return new;
end;
$$;

create or replace function private.mp_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null or new."updatedAt" is null then
    new."updatedAt" = now();
  end if;
  return new;
end;
$$;

revoke execute on function private.mp_set_created_at() from public, anon, authenticated;
revoke execute on function private.mp_set_created_updated_at() from public, anon, authenticated;
revoke execute on function private.mp_set_updated_at() from public, anon, authenticated;

drop trigger if exists transactions_set_created_at on public.transactions;
create trigger transactions_set_created_at
before insert on public.transactions
for each row execute function private.mp_set_created_at();

drop trigger if exists positions_set_created_at on public.positions;
create trigger positions_set_created_at
before insert on public.positions
for each row execute function private.mp_set_created_at();

drop trigger if exists monthly_goals_set_timestamps on public."monthlyGoals";
create trigger monthly_goals_set_timestamps
before insert on public."monthlyGoals"
for each row execute function private.mp_set_created_updated_at();

drop trigger if exists recurring_set_timestamps on public.recurring;
create trigger recurring_set_timestamps
before insert on public.recurring
for each row execute function private.mp_set_created_updated_at();

drop trigger if exists scheduled_set_timestamps on public.scheduled;
create trigger scheduled_set_timestamps
before insert on public.scheduled
for each row execute function private.mp_set_created_updated_at();

drop trigger if exists planning_set_updated_at on public.planning;
create trigger planning_set_updated_at
before insert on public.planning
for each row execute function private.mp_set_updated_at();

commit;
