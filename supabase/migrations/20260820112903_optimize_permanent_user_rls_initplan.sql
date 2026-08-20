alter policy transactions_permanent_users_only on public.transactions
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

alter policy positions_permanent_users_only on public.positions
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

alter policy recurring_permanent_users_only on public.recurring
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

alter policy scheduled_permanent_users_only on public.scheduled
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

alter policy monthly_goals_permanent_users_only on public."monthlyGoals"
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);

alter policy planning_permanent_users_only on public.planning
using (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false)
with check (coalesce((((select auth.jwt())->>'is_anonymous')::boolean), true) = false);
