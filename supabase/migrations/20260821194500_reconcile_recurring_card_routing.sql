-- Reconciles already-materialized recurring expenses when their payment route
-- changes between wallet and credit card. The database already owns source
-- routing/projection integrity; this extends that same layer rather than
-- duplicating business rules in the UI.

create or replace function public.sync_recurring_card_routing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recurring_row record;
  tx record;
  card record;
  purchase_date date;
  closing_date date;
  due_month date;
  invoice_due date;
  month_last_day integer;
  scheduled_id text;
begin
  if tg_op = 'UPDATE'
     and old."cardId" is not null
     and new."cardId" is null then
    for tx in
      select t.*
      from public.transactions t
      where t.user_id = new.user_id
        and t.type = 'expense'
        and coalesce(t.projected, false) = false
        and coalesce(t.archived, false) = true
        and t."cardId" = old."cardId"
        and (
          (t."sourceType" = 'recurring' and t."sourceId" = new.id)
          or (new.id = 'legacy_' || t.id and t.recurring = true and t."sourceType" is null)
        )
    loop
      purchase_date := coalesce(nullif(tx."purchaseDate", '')::date, tx.date::date);
      scheduled_id := 'rec_card_' || new.id || '_' || to_char(purchase_date, 'YYYYMM');

      if not exists (
        select 1
        from public.transactions posted
        where posted.user_id = new.user_id
          and posted."sourceType" = 'scheduled'
          and posted."sourceId" = scheduled_id
          and coalesce(posted.projected, false) = false
      ) then
        delete from public.scheduled s
        where s.user_id = new.user_id
          and s.id = scheduled_id
          and s.status = 'active';

        update public.transactions t
        set archived = false,
            "walletId" = new."walletId",
            "cardId" = null,
            "purchaseDate" = null
        where t.user_id = new.user_id
          and t.id = tx.id;
      end if;
    end loop;

    return new;
  end if;

  if tg_op = 'DELETE' then
    recurring_row := old;
  else
    recurring_row := new;
  end if;

  if recurring_row."cardId" is null or recurring_row.type <> 'expense' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select c.*
  into card
  from public.cards c
  where c.user_id = recurring_row.user_id
    and c.id = recurring_row."cardId"
    and c.active = true;

  if not found or card."paymentWalletId" is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  for tx in
    select t.*
    from public.transactions t
    where t.user_id = recurring_row.user_id
      and t.type = 'expense'
      and coalesce(t.projected, false) = false
      and (
        (t."sourceType" = 'recurring' and t."sourceId" = recurring_row.id)
        or (recurring_row.id = 'legacy_' || t.id and t.recurring = true and t."sourceType" is null)
      )
      and (
        coalesce(t.archived, false) = false
        or (
          coalesce(t.archived, false) = true
          and t."cardId" is not null
          and t."purchaseDate" is not null
        )
      )
  loop
    purchase_date := coalesce(nullif(tx."purchaseDate", '')::date, tx.date::date);
    if purchase_date > current_date then
      continue;
    end if;

    scheduled_id := 'rec_card_' || recurring_row.id || '_' || to_char(purchase_date, 'YYYYMM');

    if exists (
      select 1
      from public.transactions posted
      where posted.user_id = recurring_row.user_id
        and posted."sourceType" = 'scheduled'
        and posted."sourceId" = scheduled_id
        and coalesce(posted.projected, false) = false
    ) or exists (
      select 1
      from public.scheduled s
      where s.user_id = recurring_row.user_id
        and s.id = scheduled_id
        and s.status = 'posted'
    ) then
      continue;
    end if;

    month_last_day := extract(day from (date_trunc('month', purchase_date) + interval '1 month - 1 day'))::integer;
    closing_date := make_date(
      extract(year from purchase_date)::integer,
      extract(month from purchase_date)::integer,
      least(card."closingDay", month_last_day)
    );

    due_month := date_trunc('month', purchase_date)::date;
    if purchase_date >= closing_date then
      due_month := (due_month + interval '1 month')::date;
    end if;
    if card."dueDay" <= card."closingDay" then
      due_month := (due_month + interval '1 month')::date;
    end if;

    month_last_day := extract(day from (date_trunc('month', due_month) + interval '1 month - 1 day'))::integer;
    invoice_due := make_date(
      extract(year from due_month)::integer,
      extract(month from due_month)::integer,
      least(card."dueDay", month_last_day)
    );

    if invoice_due < current_date then
      continue;
    end if;

    insert into public.scheduled (
      user_id,
      id,
      name,
      type,
      amount,
      category,
      description,
      "dueDate",
      frequency,
      status,
      "walletId",
      "cardId",
      "purchaseDate",
      "installmentGroupId",
      "installmentNumber",
      "installmentTotal"
    ) values (
      recurring_row.user_id,
      scheduled_id,
      coalesce(nullif(tx.description, ''), recurring_row.name, recurring_row.category) || ' · fatura',
      'expense',
      tx.amount,
      tx.category,
      coalesce(nullif(tx.description, ''), recurring_row.name, recurring_row.category),
      to_char(invoice_due, 'YYYY-MM-DD'),
      'once',
      'active',
      card."paymentWalletId",
      card.id,
      to_char(purchase_date, 'YYYY-MM-DD'),
      null,
      null,
      null
    )
    on conflict (user_id, id) do update set
      name = excluded.name,
      type = excluded.type,
      amount = excluded.amount,
      category = excluded.category,
      description = excluded.description,
      "dueDate" = excluded."dueDate",
      frequency = 'once',
      status = 'active',
      "walletId" = excluded."walletId",
      "cardId" = excluded."cardId",
      "purchaseDate" = excluded."purchaseDate",
      "installmentGroupId" = null,
      "installmentNumber" = null,
      "installmentTotal" = null
    where public.scheduled.status = 'active';

    update public.transactions t
    set archived = true,
        "walletId" = card."paymentWalletId",
        "cardId" = card.id,
        "purchaseDate" = to_char(purchase_date, 'YYYY-MM-DD')
    where t.user_id = recurring_row.user_id
      and t.id = tx.id;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.sync_recurring_card_routing() is
  'Reconciles already materialized recurring expenses when their payment route is changed to or from a credit card, using the same closing/due-date semantics as cardInstallmentSchedule and preserving unpaid obligations without double counting.';

drop trigger if exists recurring_card_routing_sync on public.recurring;
create trigger recurring_card_routing_sync
after update or delete on public.recurring
for each row execute function public.sync_recurring_card_routing();

revoke all on function public.sync_recurring_card_routing() from public;
