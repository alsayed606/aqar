-- 0050_platform_tenant_360.sql
-- Sprint T-2 — everything the console needs to look at ONE office, plus the two operator actions
-- that were not expressible before.
--
-- 1. A new subscription status: `suspended`. Until now "cut this office off" could only be spelled
--    `canceled`, which says the customer LEFT. They are different facts and conflating them
--    corrupts churn: a suspension for non-payment would have counted as a customer lost. Nothing
--    else needs to change — app.subscription_active() lists the live statuses explicitly and fails
--    closed on anything else, so `suspended` locks new business creation the moment it exists while
--    all existing data stays readable and editable (Charter ق-هـ).
--
-- 2. operator_extend_trial(org, days) — the one-click lever. Extending from the LATER of now and the
--    current end date matters: extending an already-lapsed trial by 14 days from its old end date
--    would hand the office a trial that expired yesterday.
--
-- 3. platform_tenant_360(org) — one call, the whole office. Bound by ADR-0006: the office's own
--    PORTFOLIO is returned as counts, never rows, and not one riyal of the office's own money
--    appears here. `revenue` in this payload is what the office paid US.
--
--    One clarification this sprint forces into the open: the office's TEAM (the identities that log
--    into our platform, with their role and last sign-in) is relationship data, not tenant-owned
--    data — support cannot help an office without knowing who to call. The office's own customers,
--    the owners and tenants whose data they hold, remain counts and nothing else. That line is the
--    whole of the distinction and it is drawn here deliberately.

alter type app.subscription_status add value if not exists 'suspended';

-- ---------------------------------------------------------------------------
-- Sign-in activity. auth.users exists on Supabase but not on bare Postgres (the test harness), so
-- the table is resolved at runtime. Both readers below go through this one function, so the
-- knowledge of where sign-in times live is written down exactly once.
-- ---------------------------------------------------------------------------
create or replace function app.platform_identity_activity()
returns table (identity_id uuid, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;
  return query execute $q$ select u.id, u.last_sign_in_at from auth.users u where u.last_sign_in_at is not null $q$;
end;
$$;

create or replace function app.platform_org_activity()
returns table (org_id uuid, last_sign_in_at timestamptz, active_today int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select m.org_id,
           max(a.last_sign_in_at),
           count(*) filter (
             where (a.last_sign_in_at at time zone 'Asia/Riyadh')::date
                 = (now() at time zone 'Asia/Riyadh')::date)::int
      from app.membership m
      join app.platform_identity_activity() a on a.identity_id = m.identity_id
     where m.status = 'active' and m.deleted_at is null
     group by m.org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- operator_extend_trial(org, days)
-- ---------------------------------------------------------------------------
create or replace function app.operator_extend_trial(p_org uuid, p_days int, p_reason text default null)
returns timestamptz
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_status app.subscription_status;
  v_from   timestamptz;
  v_new    timestamptz;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_days is null or p_days <= 0 or p_days > 365 then
    raise exception 'INVALID_DAYS' using errcode = 'raise_exception';
  end if;

  select status, trial_ends_at into v_status, v_from
    from app.org_subscription where org_id = p_org;
  if v_status is null then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_status <> 'trialing' then
    raise exception 'NOT_TRIALING' using errcode = 'raise_exception';
  end if;

  -- From the later of now and the current end: extending a trial that lapsed last month by 14 days
  -- from its old end date would grant a trial that is already over.
  v_new := greatest(coalesce(v_from, now()), now()) + make_interval(days => p_days);
  update app.org_subscription set trial_ends_at = v_new where org_id = p_org;

  perform app.write_audit(p_org, 'platform.trial_extend', 'org_subscription', p_org,
    jsonb_build_object('days', p_days, 'from', v_from, 'to', v_new, 'reason', p_reason));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_tenant_360(org)
-- ---------------------------------------------------------------------------
create or replace function app.platform_tenant_360(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_org  app.organization;
  v_team jsonb;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_org from app.organization where id = p_org and deleted_at is null;
  if v_org.id is null then
    return null;  -- caller renders notFound(); an exception here would be an error, not an absence
  end if;

  -- The office's own staff: who to call, what they may do, when they were last here.
  select coalesce(jsonb_agg(t order by t->>'role', t->>'full_name'), '[]'::jsonb) into v_team
    from (
      select jsonb_build_object(
               'identity_id', i.id,
               'full_name',   i.full_name,
               'email',       i.email,
               'phone_e164',  i.phone_e164,
               'role',        m.role,
               'status',      m.status,
               'scope_all',   m.scope_all,
               'joined_at',   m.created_at,
               'last_sign_in_at', a.last_sign_in_at) as t
        from app.membership m
        join app.identity i on i.id = m.identity_id
        left join app.platform_identity_activity() a on a.identity_id = m.identity_id
       where m.org_id = p_org and m.deleted_at is null
    ) rows;

  return jsonb_build_object(
    'org', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'org_type', v_org.org_type, 'created_at', v_org.created_at),
    'subscription', (
      select jsonb_build_object(
               'plan_code', s.plan_code, 'plan_name', pl.name_ar, 'price_halalas', pl.price_halalas,
               'status', s.status, 'trial_ends_at', s.trial_ends_at,
               'current_period_end', s.current_period_end, 'auto_renew', s.auto_renew,
               'notes', s.notes, 'active', app.subscription_active(p_org))
        from app.org_subscription s left join app.plan pl on pl.code = s.plan_code
       where s.org_id = p_org),
    'limits', jsonb_build_object(
      'properties', app.plan_limit(p_org, 'properties'),
      'units',      app.plan_limit(p_org, 'units'),
      'members',    app.plan_limit(p_org, 'members')),
    'usage', jsonb_build_object(
      'properties', app.usage_count(p_org, 'properties'),
      'units',      app.usage_count(p_org, 'units'),
      'members',    app.usage_count(p_org, 'members')),
    -- Counts only. What the office manages, never a row of it (ADR-0006).
    'portfolio', jsonb_build_object(
      'properties',       (select count(*) from app.property where org_id = p_org and deleted_at is null),
      'units',            (select count(*) from app.unit     where org_id = p_org and deleted_at is null),
      'units_rented',     (select count(*) from app.unit     where org_id = p_org and deleted_at is null and current_status = 'rented'),
      'units_vacant',     (select count(*) from app.unit     where org_id = p_org and deleted_at is null and current_status = 'vacant'),
      'contracts',        (select count(*) from app.contract where org_id = p_org and deleted_at is null),
      'contracts_active', (select count(*) from app.contract where org_id = p_org and deleted_at is null and status = 'active'),
      'owners',           (select count(*) from app.owner    where org_id = p_org and deleted_at is null),
      'tenants',          (select count(*) from app.tenant   where org_id = p_org and deleted_at is null)),
    -- What this office paid US. The office's own collections are its business, not ours to display.
    'revenue', jsonb_build_object(
      'paid_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                        where org_id = p_org and status = 'paid'),
      'payments',     (select count(*) from app.subscription_payment where org_id = p_org and status = 'paid'),
      'last_paid_at', (select max(paid_at) from app.subscription_payment where org_id = p_org and status = 'paid'),
      'failed_30d',   (select count(*) from app.subscription_payment
                        where org_id = p_org and status = 'failed' and created_at >= now() - interval '30 days')),
    'payment_method', (
      select jsonb_build_object('brand', brand, 'last4', last4, 'exp_month', exp_month, 'exp_year', exp_year)
        from app.org_payment_method where org_id = p_org and status = 'active' limit 1),
    'team', v_team,
    'activity', coalesce(
      (select jsonb_build_object('last_sign_in_at', last_sign_in_at, 'active_today', active_today)
         from app.platform_org_activity() where org_id = p_org),
      jsonb_build_object('last_sign_in_at', null, 'active_today', 0)),
    'import_batches', (select count(*) from app.import_batch where org_id = p_org),
    'generated_at', now());
end;
$$;

revoke all on function app.platform_identity_activity()            from public;
revoke all on function app.operator_extend_trial(uuid, int, text)  from public;
revoke all on function app.platform_tenant_360(uuid)               from public;
grant execute on function app.platform_identity_activity()         to authenticated, service_role;
grant execute on function app.operator_extend_trial(uuid, int, text) to authenticated, service_role;
grant execute on function app.platform_tenant_360(uuid)            to authenticated, service_role;
