-- Legacy data created before the dedicated card-installment model represented
-- finite installment purchases as recurring monthly expenses. Once routed to a
-- credit card, only the current occurrence became card debt, so the remaining
-- purchase balance was absent from open balance, available limit and the
-- installment-purchases UI. Convert only that legacy cohort to the canonical
-- scheduled installment representation already used by the application.

create temporary table legacy_card_installment_candidates on commit drop as
select
  r.user_id,
  r.id as recurring_id,
  r.name,
  r.category,
  r.amount::numeric as installment_amount,
  r."cardId" as card_id,
  c."paymentWalletId" as wallet_id,
  c."dueDay" as due_day,
  coalesce(m.date::date, least(r."createdAt"::date, current_date)) as purchase_date,
  r."startDate"::date as first_due,
  case
    when m.id is not null then
      ((extract(year from r."endDate"::date)::int - extract(year from m.date::date)::int) * 12
        + extract(month from r."endDate"::date)::int - extract(month from m.date::date)::int + 1)
    else
      ((extract(year from r."endDate"::date)::int - extract(year from r."startDate"::date)::int) * 12
        + extract(month from r."endDate"::date)::int - extract(month from r."startDate"::date)::int + 1)
  end as installment_total,
  m.id as materialized_tx_id
from public.recurring r
join public.cards c
  on c.user_id = r.user_id
 and c.id = r."cardId"
 and c.active = true
left join lateral (
  select t.id, t.date
  from public.transactions t
  where t.user_id = r.user_id
    and coalesce(t.projected, false) = false
    and (
      (t."sourceType" = 'recurring' and t."sourceId" = r.id)
      or (r.id = 'legacy_' || t.id and t.recurring = true and t."sourceType" is null)
    )
  order by t.date asc, t."createdAt" asc
  limit 1
) m on true
where r.active = true
  and r.type = 'expense'
  and r."cardId" is not null
  and nullif(r."endDate", '') is not null
  and r."createdAt" < '2026-08-20 19:17:05+00'::timestamptz
  and c."paymentWalletId" is not null;

delete from legacy_card_installment_candidates
where installment_total < 1
   or installment_total > 120
   or first_due < purchase_date;

-- Route the legacy recurrence away from the card first. The existing integrity
-- trigger then removes the one-off recurring-card obligation and safely restores
-- its materialized audit row before the canonical installment rows are created.
update public.recurring r
set "cardId" = null,
    "updatedAt" = now()
from legacy_card_installment_candidates x
where r.user_id = x.user_id
  and r.id = x.recurring_id;

-- Defensive cleanup for any still-active recurring-card schedule belonging to
-- the converted legacy series.
delete from public.scheduled s
using legacy_card_installment_candidates x
where s.user_id = x.user_id
  and s.status = 'active'
  and s.id like 'rec_card_' || x.recurring_id || '_%';

-- The recurring rule is no longer the source of truth after conversion. Keeping
-- it would recreate future charges and double count the same purchase.
delete from public.recurring r
using legacy_card_installment_candidates x
where r.user_id = x.user_id
  and r.id = x.recurring_id;

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
  "installmentTotal",
  "createdAt",
  "updatedAt"
)
select
  x.user_id,
  'inst_grp_legacy_' || x.recurring_id || '_' || lpad(gs.n::text, 3, '0'),
  left(coalesce(nullif(x.name, ''), x.category), 45) || ' · ' || gs.n || '/' || x.installment_total,
  'expense',
  x.installment_amount,
  x.category,
  left(coalesce(nullif(x.name, ''), x.category), 80),
  to_char(
    make_date(
      extract(year from (date_trunc('month', x.first_due) + (gs.n - 1) * interval '1 month'))::int,
      extract(month from (date_trunc('month', x.first_due) + (gs.n - 1) * interval '1 month'))::int,
      least(
        x.due_day,
        extract(day from (date_trunc('month', x.first_due) + gs.n * interval '1 month' - interval '1 day'))::int
      )
    ),
    'YYYY-MM-DD'
  ),
  'once',
  'active',
  x.wallet_id,
  x.card_id,
  to_char(x.purchase_date, 'YYYY-MM-DD'),
  'grp_legacy_' || x.recurring_id,
  gs.n,
  x.installment_total,
  now(),
  now()
from legacy_card_installment_candidates x
cross join lateral generate_series(1, x.installment_total) as gs(n);

-- Materialized legacy occurrences remain only as archived audit evidence. They
-- must not appear as paid installments or affect wallet/month totals twice.
update public.transactions t
set archived = true,
    "walletId" = x.wallet_id,
    "cardId" = x.card_id,
    "purchaseDate" = to_char(x.purchase_date, 'YYYY-MM-DD')
from legacy_card_installment_candidates x
where x.materialized_tx_id is not null
  and t.user_id = x.user_id
  and t.id = x.materialized_tx_id;
