alter table public.transactions
  add constraint transactions_source_pair_valid
  check (("sourceType" is null) = ("sourceId" is null)),
  add constraint transactions_date_calendar_valid
  check (case when pg_input_is_valid(date, 'date') then (date::date)::text = date else false end);

alter table public.recurring
  add constraint recurring_start_date_calendar_valid
  check (case when pg_input_is_valid("startDate", 'date') then ("startDate"::date)::text = "startDate" else false end),
  add constraint recurring_end_date_calendar_valid
  check ("endDate" = '' or case when pg_input_is_valid("endDate", 'date') then ("endDate"::date)::text = "endDate" else false end),
  add constraint recurring_date_range_valid
  check ("endDate" = '' or "endDate" >= "startDate");

alter table public.scheduled
  add constraint scheduled_due_date_calendar_valid
  check (case when pg_input_is_valid("dueDate", 'date') then ("dueDate"::date)::text = "dueDate" else false end);

alter table public."monthlyGoals"
  add constraint monthly_goals_id_calendar_valid
  check (case when id ~ '^\d{4}-\d{2}$' then substring(id, 6, 2)::int between 1 and 12 else false end),
  add constraint monthly_goals_month_calendar_valid
  check (case when month ~ '^\d{4}-\d{2}$' then substring(month, 6, 2)::int between 1 and 12 else false end);

create policy transactions_permanent_users_only
on public.transactions
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);

create policy positions_permanent_users_only
on public.positions
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);

create policy recurring_permanent_users_only
on public.recurring
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);

create policy scheduled_permanent_users_only
on public.scheduled
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);

create policy monthly_goals_permanent_users_only
on public."monthlyGoals"
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);

create policy planning_permanent_users_only
on public.planning
as restrictive for all
to authenticated
using (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false)
with check (coalesce((select (auth.jwt()->>'is_anonymous')::boolean), true) = false);
