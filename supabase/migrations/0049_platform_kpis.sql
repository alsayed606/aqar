-- 0049_platform_kpis.sql
-- Sprint T-1 — the read side of the executive dashboard. Four functions, one contract each
-- (ADR-0006): SECURITY DEFINER, `FORBIDDEN` as the first statement, revoked from public, and every
-- figure is either platform-owned data or a COUNT of tenant data. Not one tenant row leaves here.
--
-- Two honesty rules are enforced in SQL rather than left to the UI:
--   • MRR counts `active` only. A trial pays nothing and a comp is a grant, so folding either into
--     recurring revenue would inflate it. `past_due` is contracted but not collecting, so it is
--     reported separately as revenue at risk instead of being quietly counted or quietly dropped.
--   • trend_since is the oldest REAL subscription event. The 0048 back-seed is dated to each
--     subscription's creation, so measuring "history" from it would claim months of trend we never
--     recorded. Reconstructed rows are excluded, and NULL means recording just started.

-- ---------------------------------------------------------------------------
-- platform_kpis() — every scalar on the dashboard in one round trip.
-- ---------------------------------------------------------------------------
create or replace function app.platform_kpis()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_month_start date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  v_prev_start  date := (date_trunc('month', (now() at time zone 'Asia/Riyadh')) - interval '1 month')::date;
  v_window      timestamptz := now() - interval '30 days';
  v_mrr         bigint;
  v_at_risk     bigint;
  v_active      int;
  v_canceled30  int;
  v_activated30 int;
  v_base        int;
  v_new_month   int;
  v_new_prev    int;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select coalesce(sum(p.price_halalas) filter (where s.status = 'active'), 0),
         coalesce(sum(p.price_halalas) filter (where s.status = 'past_due'), 0),
         count(*) filter (where s.status = 'active')::int
    into v_mrr, v_at_risk, v_active
    from app.org_subscription s
    join app.organization o on o.id = s.org_id and o.deleted_at is null
    left join app.plan p on p.code = s.plan_code;

  select count(distinct org_id) filter (where to_status = 'canceled'),
         count(distinct org_id) filter (where to_status = 'active')
    into v_canceled30, v_activated30
    from app.subscription_event
   where kind = 'status_changed' and created_at >= v_window;

  -- Customers at the start of the window, reconstructed from where we are now: those active today,
  -- minus the ones that became active during it, plus the ones that left during it.
  v_base := v_active - coalesce(v_activated30, 0) + coalesce(v_canceled30, 0);

  select count(*) filter (where (created_at at time zone 'Asia/Riyadh')::date >= v_month_start)::int,
         count(*) filter (where (created_at at time zone 'Asia/Riyadh')::date >= v_prev_start
                            and (created_at at time zone 'Asia/Riyadh')::date <  v_month_start)::int
    into v_new_month, v_new_prev
    from app.organization where deleted_at is null;

  return jsonb_build_object(
    'mrr_halalas',          v_mrr,
    'mrr_at_risk_halalas',  v_at_risk,
    'arr_halalas',          v_mrr * 12,
    'orgs_total',           (select count(*) from app.organization where deleted_at is null),
    'orgs_active',          v_active,
    'orgs_trialing',        (select count(*) from app.org_subscription where status = 'trialing'),
    'orgs_comped',          (select count(*) from app.org_subscription where status = 'comped'),
    'orgs_past_due',        (select count(*) from app.org_subscription where status = 'past_due'),
    'orgs_canceled',        (select count(*) from app.org_subscription where status = 'canceled'),
    'trials_expiring_7d',   (select count(*) from app.org_subscription
                              where status = 'trialing' and trial_ends_at is not null
                                and trial_ends_at between now() and now() + interval '7 days'),
    'subs_expiring_30d',    (select count(*) from app.org_subscription
                              where status = 'active' and current_period_end is not null
                                and current_period_end between now() and now() + interval '30 days'),
    'canceled_30d',         coalesce(v_canceled30, 0),
    'activated_30d',        coalesce(v_activated30, 0),
    'churn_rate_30d',       case when v_base > 0
                                 then round(coalesce(v_canceled30, 0)::numeric / v_base, 4) end,
    'new_orgs_month',       v_new_month,
    'new_orgs_prev_month',  v_new_prev,
    'growth_rate_month',    case when v_new_prev > 0
                                 then round((v_new_month - v_new_prev)::numeric / v_new_prev, 4) end,
    'revenue_month_halalas',(select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                              where status = 'paid' and paid_at is not null
                                and (paid_at at time zone 'Asia/Riyadh')::date >= v_month_start),
    'revenue_prev_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                              where status = 'paid' and paid_at is not null
                                and (paid_at at time zone 'Asia/Riyadh')::date >= v_prev_start
                                and (paid_at at time zone 'Asia/Riyadh')::date <  v_month_start),
    'failed_payments_30d',  (select count(*) from app.subscription_payment
                              where status = 'failed' and created_at >= v_window),
    'properties',           (select count(*) from app.property where deleted_at is null),
    'units',                (select count(*) from app.unit     where deleted_at is null),
    'contracts',            (select count(*) from app.contract where deleted_at is null),
    'users',                (select count(distinct identity_id) from app.membership
                              where status = 'active' and deleted_at is null),
    'active_today',         (select coalesce(sum(active_today), 0) from app.platform_org_activity()),
    'trend_since',          (select min(created_at) from app.subscription_event
                              where coalesce((detail->>'reconstructed')::boolean, false) = false),
    'generated_at',         now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_revenue_series(months) — collected revenue and new offices per month, oldest first.
-- Months with nothing in them are still returned: a gap in a trend line must read as zero, not as
-- an absent point that the chart would silently close over.
-- ---------------------------------------------------------------------------
create or replace function app.platform_revenue_series(p_months int default 12)
returns table (month_start date, paid_halalas bigint, payments int, new_orgs int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with months as (
      select generate_series(
               date_trunc('month', (now() at time zone 'Asia/Riyadh'))
                 - make_interval(months => greatest(p_months, 1) - 1),
               date_trunc('month', (now() at time zone 'Asia/Riyadh')),
               interval '1 month')::date as m
    )
    select months.m,
           coalesce((select sum(sp.amount_halalas) from app.subscription_payment sp
                      where sp.status = 'paid' and sp.paid_at is not null
                        and date_trunc('month', (sp.paid_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::bigint,
           coalesce((select count(*) from app.subscription_payment sp
                      where sp.status = 'paid' and sp.paid_at is not null
                        and date_trunc('month', (sp.paid_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::int,
           coalesce((select count(*) from app.organization o
                      where o.deleted_at is null
                        and date_trunc('month', (o.created_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::int
      from months
     order by months.m;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_plan_distribution() — how the customer base sits across the catalog. Every plan is
-- returned, including the ones nobody is on: an empty tier is itself the answer to "is anyone
-- buying Enterprise".
-- ---------------------------------------------------------------------------
create or replace function app.platform_plan_distribution()
returns table (plan_code text, plan_name_ar text, price_halalas bigint,
               orgs int, orgs_active int, mrr_halalas bigint)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select p.code, p.name_ar, p.price_halalas,
           count(s.org_id)::int,
           count(s.org_id) filter (where s.status = 'active')::int,
           (count(s.org_id) filter (where s.status = 'active') * p.price_halalas)::bigint
      from app.plan p
      left join app.org_subscription s on s.plan_code = p.code
      left join app.organization o on o.id = s.org_id and o.deleted_at is null
     group by p.code, p.name_ar, p.price_halalas, p.sort
     order by p.sort;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_top_customers(limit) — by what they have actually paid us, not by what they were billed.
-- ---------------------------------------------------------------------------
create or replace function app.platform_top_customers(p_limit int default 5)
returns table (org_id uuid, org_name text, plan_code text, paid_halalas bigint, payments int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select o.id, o.name, s.plan_code,
           coalesce(sum(sp.amount_halalas), 0)::bigint,
           count(sp.id)::int
      from app.organization o
      left join app.org_subscription s on s.org_id = o.id
      left join app.subscription_payment sp on sp.org_id = o.id and sp.status = 'paid'
     where o.deleted_at is null
     group by o.id, o.name, s.plan_code
    having coalesce(sum(sp.amount_halalas), 0) > 0
     order by 4 desc
     limit greatest(p_limit, 1);
end;
$$;

revoke all on function app.platform_kpis()                  from public;
revoke all on function app.platform_revenue_series(int)     from public;
revoke all on function app.platform_plan_distribution()     from public;
revoke all on function app.platform_top_customers(int)      from public;
grant execute on function app.platform_kpis()               to authenticated, service_role;
grant execute on function app.platform_revenue_series(int)  to authenticated, service_role;
grant execute on function app.platform_plan_distribution()  to authenticated, service_role;
grant execute on function app.platform_top_customers(int)   to authenticated, service_role;
