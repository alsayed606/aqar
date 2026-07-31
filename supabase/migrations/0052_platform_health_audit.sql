-- 0052_platform_health_audit.sql
-- Sprint T-4 — platform health, system alerts, and the audit centre.
--
-- One instrumentation gap had to be closed first: THE CRON JOBS LEFT NO TRACE. The notification
-- drainer and the renewal engine ran on Vercel Cron and reported nothing to us, so "did the mail
-- queue drain last night" was unanswerable — and a cron that silently stopped firing looked exactly
-- like a cron with nothing to do. app.cron_run records every run. That is the difference between a
-- health page that reports and one that guesses.
--
-- Everything else here reads records we already keep. What lives OUTSIDE this database — Supabase
-- storage, edge functions, the Vercel runtime, the payment provider's own uptime — is reported as
-- unmeasured, with a link out. A green dot we did not observe is worse than no dot.
--
-- AUDIT AND THE ISOLATION LINE (ADR-0006). Audit rows carry two different kinds of thing: the
-- METADATA of an action (who, what, which office, when) and its `detail` payload, which for office
-- actions can contain the office's own figures. The metadata is not tenant data — it is the shape of
-- activity, the same category as a count. The payload can be. So the platform audit reader returns
-- every row's metadata and returns `detail` ONLY for `platform.*` actions: the console can see that
-- an office activated twelve contracts last week without reading one of them.

-- ---------------------------------------------------------------------------
-- cron_run — one row per scheduled run. Platform-only (RLS on, no policy).
-- ---------------------------------------------------------------------------
create table if not exists app.cron_run (
  id          bigint generated always as identity primary key,
  job         text not null,
  ok          boolean not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  duration_ms int,
  detail      jsonb not null default '{}'::jsonb,
  error       text
);

create index if not exists cron_run_job_idx on app.cron_run (job, finished_at desc);

alter table app.cron_run enable row level security;  -- no policy → DEFINER-only, like every platform table

-- Written by the cron routes, which run as service_role. Not granted to authenticated: a signed-in
-- user must never be able to forge a "the job ran fine" record.
create or replace function app.record_cron_run(
  p_job text, p_ok boolean, p_started_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb, p_error text default null
) returns void
language sql security definer set search_path = app, pg_temp as $$
  insert into app.cron_run (job, ok, started_at, finished_at, duration_ms, detail, error)
  values (p_job, p_ok, coalesce(p_started_at, now()), now(),
          case when p_started_at is null then null
               else greatest(0, (extract(epoch from (now() - p_started_at)) * 1000)::int) end,
          coalesce(p_detail, '{}'::jsonb), p_error);
$$;

-- ---------------------------------------------------------------------------
-- platform_health() — the subsystems we can actually observe from in here.
-- ---------------------------------------------------------------------------
create or replace function app.platform_health()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return jsonb_build_object(
    'email_queue', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'failed',  count(*) filter (where status = 'failed'),
        'sent_24h',count(*) filter (where status = 'sent' and sent_at >= now() - interval '24 hours'),
        -- Due to be retried and still sitting there: the drainer is not keeping up, or not running.
        'overdue', count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '1 hour'),
        'oldest_pending_at', min(created_at) filter (where status = 'pending'))
      from app.notification_delivery),
    'notifications', (
      select jsonb_build_object(
        'total_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
        'unread',    count(*) filter (where read_at is null))
      from app.notification),
    'cron', (
      select coalesce(jsonb_agg(j order by j->>'job'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'job', r.job,
                 'last_run_at', r.finished_at,
                 'ok', r.ok,
                 'duration_ms', r.duration_ms,
                 'error', r.error,
                 'failures_24h', (select count(*) from app.cron_run f
                                   where f.job = r.job and not f.ok and f.finished_at >= now() - interval '24 hours')
               ) as j
          from app.cron_run r
          join (select job, max(finished_at) as m from app.cron_run group by job) last
            on last.job = r.job and last.m = r.finished_at
      ) rows),
    'payments', (
      select jsonb_build_object(
        'paid_24h',   count(*) filter (where status = 'paid'   and created_at >= now() - interval '24 hours'),
        'failed_24h', count(*) filter (where status = 'failed' and created_at >= now() - interval '24 hours'),
        -- An intent that never heard back from the gateway. One or two is noise; a pile means the
        -- webhook is not arriving.
        'awaiting_webhook', count(*) filter (where status = 'initiated' and created_at < now() - interval '1 hour'),
        'last_webhook_at', max(paid_at) filter (where status = 'paid'))
      from app.subscription_payment),
    'imports', (
      select jsonb_build_object(
        'batches_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
        'stuck', count(*) filter (where status = 'validated' and created_at < now() - interval '7 days'))
      from app.import_batch),
    'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_alerts() — one prioritized list rather than a wall of disconnected cards. `kind` is a
-- stable key the UI maps to a destination; SQL stays free of routes.
-- Severity: 1 = act now, 2 = look today, 3 = worth knowing.
-- ---------------------------------------------------------------------------
create or replace function app.platform_alerts()
returns table (kind text, severity int, count int, detail jsonb)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
  with a as (
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
           (select count(*)::int from app.org_subscription s
             where (app.plan_limit(s.org_id, 'properties') is not null
                    and app.usage_count(s.org_id, 'properties') >= app.plan_limit(s.org_id, 'properties'))
                or (app.plan_limit(s.org_id, 'units') is not null
                    and app.usage_count(s.org_id, 'units') >= app.plan_limit(s.org_id, 'units'))
                or (app.plan_limit(s.org_id, 'members') is not null
                    and app.usage_count(s.org_id, 'members') >= app.plan_limit(s.org_id, 'members'))),
           '{}'::jsonb
  )
  select a.kind, a.severity, a.count, a.detail from a where a.count > 0 order by a.severity, a.count desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_list_audit(...) — the audit centre. `detail` is returned for platform actions only; for
-- office actions the row still names who did what to which office and when.
-- ---------------------------------------------------------------------------
create or replace function app.platform_list_audit(
  p_org    uuid default null,
  p_action text default null,
  p_search text default null,
  p_platform_only boolean default false,
  p_limit  int default 30,
  p_offset int default 0
)
returns table (
  id bigint, created_at timestamptz, action text, org_id uuid, org_name text,
  identity_id uuid, actor_name text, is_platform_action boolean,
  entity_type text, entity_id uuid, detail jsonb, total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select l.*, o.name as org_name, i.full_name as actor_name,
             (l.action like 'platform.%') as is_platform
        from app.audit_log l
        left join app.organization o on o.id = l.org_id
        left join app.identity i on i.id = l.identity_id
       where (p_org is null or l.org_id = p_org)
         and (p_action is null or l.action = p_action)
         and (not p_platform_only or l.action like 'platform.%')
         and (p_search is null
              or l.action ilike '%' || p_search || '%'
              or o.name   ilike '%' || p_search || '%'
              or i.full_name ilike '%' || p_search || '%')
    )
    select m.id, m.created_at, m.action, m.org_id, m.org_name,
           m.identity_id, m.actor_name, m.is_platform,
           m.entity_type, m.entity_id,
           -- The payload of an office action can hold that office's own figures; the platform sees
           -- that the action happened, not what was inside it (ADR-0006).
           case when m.is_platform then m.detail else null end,
           count(*) over ()
      from matched m
     order by m.id desc
     limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

-- platform_audit_actions() — the distinct action names, for the filter. Cheap on a small log and
-- honest about what actually exists rather than a hardcoded list that drifts.
create or replace function app.platform_audit_actions()
returns table (action text, count int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select l.action, count(*)::int from app.audit_log l group by l.action order by 2 desc, 1;
end;
$$;

-- 0001 sets `alter default privileges in schema app grant execute on functions to anon,
-- authenticated, service_role`, so a new function is granted to those roles the moment it is
-- created and `revoke ... from public` does NOT take that away. Every gated function relies on its
-- internal FORBIDDEN check and is unaffected; a function with NO internal gate, like this one, must
-- name the roles explicitly or any signed-in user can call it. See 0053.
revoke all on function app.record_cron_run(text, boolean, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function app.platform_health()          from public;
revoke all on function app.platform_alerts()          from public;
revoke all on function app.platform_list_audit(uuid, text, text, boolean, int, int) from public;
revoke all on function app.platform_audit_actions()   from public;
grant execute on function app.record_cron_run(text, boolean, timestamptz, jsonb, text) to service_role;
grant execute on function app.platform_health()       to authenticated, service_role;
grant execute on function app.platform_alerts()       to authenticated, service_role;
grant execute on function app.platform_list_audit(uuid, text, text, boolean, int, int) to authenticated, service_role;
grant execute on function app.platform_audit_actions() to authenticated, service_role;
