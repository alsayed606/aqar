-- 0021_dashboard_kpis.sql
-- Office dashboard finance aggregates in ONE row for the caller's active org.
-- Money SUMS live here because PostgREST disables aggregate functions over the REST API; the plain
-- counts (properties / units / contracts) are cheap head-count queries done in the app layer.
--
-- SECURITY INVOKER: RLS on app.charge_balance and app.payment scopes every sum to the caller's
-- active org (x-active-org header → current_org_id()). Same pattern as app.owner_statement (0020).
-- Month boundaries are computed in Asia/Riyadh so "this month" matches the office's local calendar.

create or replace function app.dashboard_finance()
returns table (
  outstanding_halalas      bigint,   -- total unpaid balance across all charges (receivable)
  overdue_halalas          bigint,   -- portion of the above whose due_date has passed
  overdue_charges          bigint,   -- how many charges are overdue
  collected_month_halalas  bigint,   -- payments received since the 1st of the current month
  collected_prev_halalas   bigint    -- payments received in the previous calendar month (for a trend)
)
language sql
stable
security invoker
set search_path = app, pg_temp
as $$
  with tz as (
    select date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date as month_start
  ),
  bounds as (
    select
      month_start,
      (month_start - interval '1 month')::date as prev_start
    from tz
  ),
  outstanding as (
    select
      coalesce(sum(cb.balance_halalas), 0)::bigint                            as bal,
      coalesce(sum(cb.balance_halalas) filter (where cb.is_overdue), 0)::bigint as overdue,
      coalesce(count(*) filter (where cb.is_overdue), 0)::bigint              as overdue_n
    from app.charge_balance cb
    where cb.balance_halalas > 0
  ),
  pay as (
    select
      coalesce(sum(p.amount_halalas) filter (
        where (p.received_at at time zone 'Asia/Riyadh')::date >= (select month_start from bounds)
      ), 0)::bigint as this_month,
      coalesce(sum(p.amount_halalas) filter (
        where (p.received_at at time zone 'Asia/Riyadh')::date >= (select prev_start  from bounds)
          and (p.received_at at time zone 'Asia/Riyadh')::date <  (select month_start from bounds)
      ), 0)::bigint as prev_month
    from app.payment p
    where p.deleted_at is null
  )
  select o.bal, o.overdue, o.overdue_n, pay.this_month, pay.prev_month
  from outstanding o cross join pay;
$$;

grant execute on function app.dashboard_finance() to authenticated, service_role;
