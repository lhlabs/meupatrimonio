alter table public.transactions
  add column if not exists projected boolean not null default false;

comment on column public.transactions.projected is
  'True only for future scheduled commitments mirrored into transactions for unified projections.';

alter table public.transactions
  drop constraint if exists transactions_projected_source_valid;

alter table public.transactions
  add constraint transactions_projected_source_valid
  check (
    not projected
    or (
      "sourceType" = 'scheduled'
      and "sourceId" is not null
      and archived = false
    )
  );

create index if not exists transactions_projected_by_user_date_idx
  on public.transactions (user_id, date)
  where projected = true;

create or replace function public.sync_scheduled_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  projection_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.transactions
    where user_id = old.user_id
      and "sourceType" = 'scheduled'
      and "sourceId" = old.id
      and projected = true;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.status = 'active'
     and new."installmentGroupId" is null
     and new."dueDate" is not null then
    projection_id := 'proj_' || md5(new.user_id::text || ':' || new.id || ':' || new."dueDate");

    insert into public.transactions (
      user_id,
      id,
      type,
      amount,
      category,
      description,
      date,
      recurring,
      "sourceType",
      "sourceId",
      "walletId",
      "cardId",
      "purchaseDate",
      "installmentGroupId",
      "installmentNumber",
      "installmentTotal",
      archived,
      projected
    ) values (
      new.user_id,
      projection_id,
      new.type,
      new.amount,
      new.category,
      coalesce(new.description, new.name, ''),
      new."dueDate",
      false,
      'scheduled',
      new.id,
      new."walletId",
      new."cardId",
      new."purchaseDate",
      null,
      null,
      null,
      false,
      true
    )
    on conflict (user_id, id) do update set
      type = excluded.type,
      amount = excluded.amount,
      category = excluded.category,
      description = excluded.description,
      date = excluded.date,
      recurring = false,
      "sourceType" = 'scheduled',
      "sourceId" = excluded."sourceId",
      "walletId" = excluded."walletId",
      "cardId" = excluded."cardId",
      "purchaseDate" = excluded."purchaseDate",
      "installmentGroupId" = null,
      "installmentNumber" = null,
      "installmentTotal" = null,
      archived = false,
      projected = true;
  end if;

  return new;
end;
$$;

comment on function public.sync_scheduled_projection() is
  'Keeps non-installment scheduled commitments mirrored as projected transactions without materializing them as paid.';

drop trigger if exists scheduled_projection_sync on public.scheduled;
create trigger scheduled_projection_sync
after insert or update or delete on public.scheduled
for each row execute function public.sync_scheduled_projection();

revoke all on function public.sync_scheduled_projection() from public;

insert into public.transactions (
  user_id,
  id,
  type,
  amount,
  category,
  description,
  date,
  recurring,
  "sourceType",
  "sourceId",
  "walletId",
  "cardId",
  "purchaseDate",
  "installmentGroupId",
  "installmentNumber",
  "installmentTotal",
  archived,
  projected
)
select
  s.user_id,
  'proj_' || md5(s.user_id::text || ':' || s.id || ':' || s."dueDate"),
  s.type,
  s.amount,
  s.category,
  coalesce(s.description, s.name, ''),
  s."dueDate",
  false,
  'scheduled',
  s.id,
  s."walletId",
  s."cardId",
  s."purchaseDate",
  null,
  null,
  null,
  false,
  true
from public.scheduled s
where s.status = 'active'
  and s."installmentGroupId" is null
on conflict (user_id, id) do update set
  type = excluded.type,
  amount = excluded.amount,
  category = excluded.category,
  description = excluded.description,
  date = excluded.date,
  recurring = false,
  "sourceType" = 'scheduled',
  "sourceId" = excluded."sourceId",
  "walletId" = excluded."walletId",
  "cardId" = excluded."cardId",
  "purchaseDate" = excluded."purchaseDate",
  "installmentGroupId" = null,
  "installmentNumber" = null,
  "installmentTotal" = null,
  archived = false,
  projected = true;