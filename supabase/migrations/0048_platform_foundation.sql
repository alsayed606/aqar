-- 0048_platform_foundation.sql
-- Sprint T-0 — the foundation the super-admin console stands on. No UI-facing feature here; this
-- closes the three things that made the console impossible to build honestly:
--
-- 1. THE HISTORY GAP. app.org_subscription is overwritten in place, so churn, growth, MRR trend and
--    "when did this office upgrade" were not computable — the data never existed. app.subscription_event
--    is an append-only log written by a TRIGGER on org_subscription, so it captures every change
--    whatever made it (operator RPC, billing engine, webhook, manual SQL) with no call site to
--    remember to instrument. The plan's list price is SNAPSHOTTED on each row so re-pricing a plan
--    later cannot rewrite past revenue.
--
-- 2. THE AUDIT GAP (Charter §11.5). operator_set_subscription changes a customer's plan or suspends
--    their account and wrote NO audit trail. It does now — an Audit Center with nothing to show
--    would have been theatre.
--
-- 3. THE SCALE GAP. operator_list_orgs() returned EVERY org, each with three usage counts. At a
--    thousand offices that is a thousand round trips through three counting queries on every page
--    view. Replaced by app.platform_list_orgs(...) — searchable, filterable, paged, one call, and it
--    carries the plan limits so the console can draw usage against them.
--
-- Access model unchanged and non-negotiable: every platform function is SECURITY DEFINER with
-- `if not app.is_platform_operator() then raise FORBIDDEN` as its FIRST statement, revoked from
-- public. Nothing here reads a tenant's rows — only counts and platform-owned records.

-- ---------------------------------------------------------------------------
-- subscription_event — append-only subscription history. Platform-only: RLS on with NO policy, so
-- it is unreachable except through the SECURITY DEFINER readers below.
-- ---------------------------------------------------------------------------
create table if not exists app.subscription_event (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references app.organization(id) on delete cascade,
  kind                text not null check (kind in
                        ('created','plan_changed','status_changed','trial_extended','period_extended')),
  from_plan           text,
  to_plan             text,
  from_status         app.subscription_status,
  to_status           app.subscription_status,
  -- The plan's list price AT THIS MOMENT. Not "MRR": which statuses count as revenue is a reporting
  -- decision that belongs in the KPI query, not frozen into the log.
  plan_price_halalas  bigint not null default 0,
  actor_identity_id   uuid,
  detail              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists subscription_event_org_idx  on app.subscription_event (org_id, created_at desc);
create index if not exists subscription_event_time_idx on app.subscription_event (created_at desc);

alter table app.subscription_event enable row level security;  -- no policy → DEFINER-only, like platform_operator

create or replace function app.tg_subscription_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'SUBSCRIPTION_EVENT_APPEND_ONLY: subscription_event rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

drop trigger if exists subscription_event_immutable on app.subscription_event;
create trigger subscription_event_immutable before update or delete on app.subscription_event
  for each row execute function app.tg_subscription_event_immutable();

-- Capture trigger. A single UPDATE can change several fields at once (operator_set_subscription sets
-- plan and status together), so `kind` names the most significant change while from_/to_ columns
-- record every one of them — no information is lost by the labelling.
create or replace function app.tg_subscription_event() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_kind  text;
  v_price bigint;
begin
  if tg_op = 'INSERT' then
    v_kind := 'created';
  elsif new.plan_code          is distinct from old.plan_code          then v_kind := 'plan_changed';
  elsif new.status             is distinct from old.status             then v_kind := 'status_changed';
  elsif new.trial_ends_at      is distinct from old.trial_ends_at      then v_kind := 'trial_extended';
  elsif new.current_period_end is distinct from old.current_period_end then v_kind := 'period_extended';
  else
    return null;  -- e.g. a notes-only edit: nothing worth a history row
  end if;

  select price_halalas into v_price from app.plan where code = new.plan_code;

  insert into app.subscription_event (
    org_id, kind, from_plan, to_plan, from_status, to_status,
    plan_price_halalas, actor_identity_id, detail)
  values (
    new.org_id, v_kind,
    case when tg_op = 'UPDATE' then old.plan_code end, new.plan_code,
    case when tg_op = 'UPDATE' then old.status    end, new.status,
    coalesce(v_price, 0), auth.uid(),
    jsonb_build_object('trial_ends_at', new.trial_ends_at, 'current_period_end', new.current_period_end));
  return null;
end;
$$;

drop trigger if exists org_subscription_event on app.org_subscription;
create trigger org_subscription_event after insert or update on app.org_subscription
  for each row execute function app.tg_subscription_event();

-- Seed one 'created' row per subscription that predates the trigger, so today's state has an origin
-- on the timeline. This is a RECONSTRUCTION from the current row, not recovered history — history was
-- never stored and no query can invent it; `detail.reconstructed` marks these so a chart can say so.
-- On a fresh database the trigger above has already supplied the origin row and this is a no-op, so
-- the invariant to hold onto is "every subscription has an origin event", whichever wrote it.
insert into app.subscription_event (org_id, kind, to_plan, to_status, plan_price_halalas, detail, created_at)
select s.org_id, 'created', s.plan_code, s.status, coalesce(p.price_halalas, 0),
       jsonb_build_object('reconstructed', true), s.created_at
  from app.org_subscription s
  left join app.plan p on p.code = s.plan_code
 where not exists (select 1 from app.subscription_event e where e.org_id = s.org_id);

-- ---------------------------------------------------------------------------
-- Platform readers.
-- ---------------------------------------------------------------------------

-- platform_org_activity() — last sign-in and today's active users per org, from auth.users.
-- auth.users exists on Supabase but not on bare Postgres (the test harness), so the table is
-- resolved at runtime and its absence returns no rows rather than an error: the console degrades to
-- "—" instead of failing.
create or replace function app.platform_org_activity()
returns table (org_id uuid, last_sign_in_at timestamptz, active_today int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;
  return query execute $q$
    select m.org_id,
           max(u.last_sign_in_at),
           count(*) filter (
             where (u.last_sign_in_at at time zone 'Asia/Riyadh')::date
                 = (now() at time zone 'Asia/Riyadh')::date)::int
      from app.membership m
      join auth.users u on u.id = m.identity_id
     where m.status = 'active' and m.deleted_at is null
     group by m.org_id
  $q$;
end;
$$;

-- platform_list_orgs(...) — one paged, searchable, filterable page of the tenant list, carrying the
-- plan limits so usage can be drawn against them. total_count is the size of the FILTERED set,
-- repeated on every row (window function) so the caller gets it without a second query.
-- p_org narrows to a single office, so the detail page reads the SAME row shape as the list rather
-- than a near-copy of this query living somewhere else.
drop function if exists app.platform_list_orgs(uuid, text, app.subscription_status, int, int);
create or replace function app.platform_list_orgs(
  p_org    uuid default null,
  p_search text default null,
  p_status app.subscription_status default null,
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  org_id uuid, org_name text, created_at timestamptz,
  plan_code text, plan_name_ar text, plan_price_halalas bigint,
  status app.subscription_status, trial_ends_at timestamptz, current_period_end timestamptz,
  properties int, units int, members int,
  max_properties int, max_units int, max_members int,
  last_sign_in_at timestamptz, active_today int,
  total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select o.id, o.name, o.created_at, s.plan_code, s.status, s.trial_ends_at, s.current_period_end
        from app.organization o
        left join app.org_subscription s on s.org_id = o.id
       where o.deleted_at is null
         and (p_org    is null or o.id = p_org)
         and (p_search is null or o.name ilike '%' || p_search || '%')
         and (p_status is null or s.status = p_status)
    ),
    page as (
      select m.*, count(*) over () as total
        from matched m
       order by m.created_at desc
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    )
    select pg.id, pg.name, pg.created_at,
           pg.plan_code, pl.name_ar, pl.price_halalas,
           pg.status, pg.trial_ends_at, pg.current_period_end,
           app.usage_count(pg.id, 'properties'), app.usage_count(pg.id, 'units'), app.usage_count(pg.id, 'members'),
           pl.max_properties, pl.max_units, pl.max_members,
           act.last_sign_in_at, coalesce(act.active_today, 0),
           pg.total
      from page pg
      left join app.plan pl on pl.code = pg.plan_code
      left join app.platform_org_activity() act on act.org_id = pg.id
     order by pg.created_at desc;
end;
$$;

-- Superseded by platform_list_orgs: unpaged, and it could not carry limits or activity.
drop function if exists app.operator_list_orgs();

-- platform_subscription_history(org) — the timeline behind one office.
create or replace function app.platform_subscription_history(p_org uuid)
returns setof app.subscription_event
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select * from app.subscription_event where org_id = p_org order by created_at desc, id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- write_audit — corrects a latent mis-stamping that only surfaced once a platform action existed.
-- membership_id was taken from app.current_membership_id(), which resolves against the CURRENT
-- x-active-org header, not against p_org. For office actions the two always agree, so this never
-- bit. For a platform action on another org — or for org.create, where the audited org is the one
-- just born — it stamped the operator's membership in a DIFFERENT org, reading as though that
-- membership had acted on this org. The membership is now recorded only when it actually belongs to
-- the org being audited; otherwise NULL, which is the honest answer and the marker of a platform
-- action. Everything else about the function is unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.write_audit(
  p_org uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  insert into app.audit_log (org_id, identity_id, membership_id, action, entity_type, entity_id, detail)
  values (
    p_org,
    auth.uid(),
    case when p_org is not null and p_org = app.current_org_id()
         then app.current_membership_id() end,
    p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- operator_set_subscription — unchanged behaviour, plus the audit trail it always should have had.
-- ---------------------------------------------------------------------------
create or replace function app.operator_set_subscription(
  p_org uuid, p_plan text default null, p_status app.subscription_status default null,
  p_trial_ends_at timestamptz default null, p_period_end timestamptz default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before app.org_subscription;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_plan is not null and not exists (select 1 from app.plan where code = p_plan) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select * into v_before from app.org_subscription where org_id = p_org;
  if v_before.org_id is null then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.org_subscription
     set plan_code          = coalesce(p_plan, plan_code),
         status             = coalesce(p_status, status),
         trial_ends_at      = coalesce(p_trial_ends_at, trial_ends_at),
         current_period_end = coalesce(p_period_end, current_period_end),
         notes              = coalesce(p_notes, notes)
   where org_id = p_org;

  perform app.write_audit(p_org, 'platform.subscription_update', 'org_subscription', p_org,
    jsonb_build_object(
      'before', jsonb_build_object('plan', v_before.plan_code, 'status', v_before.status,
                                   'trial_ends_at', v_before.trial_ends_at,
                                   'current_period_end', v_before.current_period_end),
      'requested', jsonb_build_object('plan', p_plan, 'status', p_status,
                                      'trial_ends_at', p_trial_ends_at, 'period_end', p_period_end,
                                      'notes', p_notes)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Same shape as every platform function: nothing to public; the FORBIDDEN gate inside each
-- function is what actually authorizes, not the grant.
-- ---------------------------------------------------------------------------
revoke all on function app.platform_org_activity()                                  from public;
revoke all on function app.platform_list_orgs(uuid, text, app.subscription_status, int, int) from public;
revoke all on function app.platform_subscription_history(uuid)                      from public;
grant execute on function app.platform_org_activity()                               to authenticated, service_role;
grant execute on function app.platform_list_orgs(uuid, text, app.subscription_status, int, int) to authenticated, service_role;
grant execute on function app.platform_subscription_history(uuid)                   to authenticated, service_role;
