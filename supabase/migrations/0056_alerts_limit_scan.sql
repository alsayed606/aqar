-- 0056_alerts_limit_scan.sql
-- Performance fix from the console review. Same answer, far less work.
--
-- The `limit_reached` alert asked, per subscription, whether the office had hit any of its three
-- plan ceilings — through app.plan_limit and app.usage_count, each a SECURITY DEFINER call wrapping
-- its own query. Written as a boolean OR of three pairs, that is SIX plan_limit calls and THREE
-- usage_count calls for EVERY subscription on the platform, and each usage_count is a count(*) over
-- property, unit or membership. At a thousand offices that is roughly nine thousand aggregate
-- queries — and not on some rarely-opened report, but on the executive dashboard, because the alert
-- banner at the top of it calls platform_alerts on every load.
--
-- This is the same shape as the problem T-0 fixed in operator_list_orgs (a per-row count on an
-- unbounded set), reintroduced from another direction. The counts are now three grouped aggregates
-- computed once and joined, so the cost stops depending on the number of offices in that way.
--
-- Behaviour is identical, deliberately including one thing that is arguably wrong: soft-deleted
-- organizations are still counted, exactly as before. platform_kpis excludes them, so the two
-- disagree — but a refactor is not the place to change an answer. Left as-is and flagged.

create or replace function app.platform_alerts()
returns table (kind text, severity int, count int, detail jsonb)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
  with usage as (
    -- One pass per resource for the whole platform, instead of one call per office per resource.
    select s.org_id,
           pl.max_properties, pl.max_units, pl.max_members,
           coalesce(p.n, 0) as properties, coalesce(u.n, 0) as units, coalesce(m.n, 0) as members
      from app.org_subscription s
      join app.plan pl on pl.code = s.plan_code
      left join (select org_id, count(*) n from app.property   where deleted_at is null group by org_id) p on p.org_id = s.org_id
      left join (select org_id, count(*) n from app.unit       where deleted_at is null group by org_id) u on u.org_id = s.org_id
      left join (select org_id, count(*) n from app.membership
                  where status = 'active' and deleted_at is null group by org_id) m on m.org_id = s.org_id
  ),
  a as (
    -- A cron that failed is the alert that hides every other alert: the queues it drains stop
    -- moving and nothing else on this page can be trusted to be current.
    select 'cron_failed'::text as kind, 1 as severity,
           (select count(*)::int from app.cron_run where not ok and finished_at >= now() - interval '24 hours') as count,
           (select coalesce(jsonb_agg(distinct job), '[]'::jsonb) from app.cron_run
             where not ok and finished_at >= now() - interval '24 hours') as detail
    union all
    select 'email_failed', 1,
           (select count(*)::int from app.notification_delivery where status = 'failed'),
           '{}'::jsonb
    union all
    select 'email_overdue', 2,
           (select count(*)::int from app.notification_delivery
             where status = 'pending' and next_attempt_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'payment_failed', 1,
           (select count(*)::int from app.subscription_payment
             where status = 'failed' and created_at >= now() - interval '7 days'),
           '{}'::jsonb
    union all
    select 'payment_awaiting_webhook', 2,
           (select count(*)::int from app.subscription_payment
             where status = 'initiated' and created_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'subscription_past_due', 1,
           (select count(*)::int from app.org_subscription where status = 'past_due'),
           '{}'::jsonb
    union all
    select 'trial_lapsed', 2,
           (select count(*)::int from app.org_subscription
             where status = 'trialing' and trial_ends_at is not null and trial_ends_at < now()),
           '{}'::jsonb
    union all
    select 'renewal_without_card', 2,
           (select count(*)::int from app.org_subscription s
             where s.status = 'active'
               and s.current_period_end between now() and now() + interval '30 days'
               and not exists (select 1 from app.org_payment_method m
                                where m.org_id = s.org_id and m.status = 'active')),
           '{}'::jsonb
    union all
    -- At or over a plan ceiling. Nothing broke — the office simply cannot add anything, which is a
    -- sales conversation, not an incident.
    select 'limit_reached', 3,
           (select count(*)::int from usage
             where (max_properties is not null and properties >= max_properties)
                or (max_units      is not null and units      >= max_units)
                or (max_members    is not null and members    >= max_members)),
           '{}'::jsonb
  )
  select a.kind, a.severity, a.count, a.detail from a where a.count > 0 order by a.severity, a.count desc;
end;
$$;

revoke all on function app.platform_alerts() from public;
grant execute on function app.platform_alerts() to authenticated, service_role;
