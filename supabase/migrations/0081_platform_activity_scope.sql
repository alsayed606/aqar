-- 0081_platform_activity_scope.sql
-- One office's page stops reading the whole platform.
--
-- Finding 4 of an earlier clean-code review, unaddressed since. app.platform_tenant_360(org) is the
-- operator's detail page for a SINGLE office, and it reaches the platform-wide activity functions
-- twice:
--
--   * `left join app.platform_identity_activity()` — every user on the platform who has ever signed
--     in, joined against one org's dozen memberships;
--   * `from app.platform_org_activity() where org_id = p_org` — that same scan, grouped by org for
--     EVERY org, and then all but one row thrown away.
--
-- It is correct and it is invisible today, which is exactly why it survived: with a handful of
-- offices the waste is milliseconds. It grows with the number of offices on the platform rather than
-- with the size of the office being looked at — the shape of cost that is cheapest to fix before
-- there is data and most painful after.
--
-- Nothing here changes what any caller sees. Same columns, same values, same ordering.

-- ---------------------------------------------------------------------------
-- 1. The scoped twins
-- ---------------------------------------------------------------------------
-- The no-argument versions are kept exactly as they are: app.platform_kpis (0049) sums active_today
-- across the whole platform and genuinely wants every org. This is a second reader with a narrower
-- question, not a replacement.
--
-- auth.users is resolved at runtime because it exists on Supabase and not on the bare Postgres of
-- the test harness — the same reason, and the same shape, as 0050.
create or replace function app.platform_identity_activity(p_org uuid)
returns table (identity_id uuid, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;
  return query execute $q$
    select u.id, u.last_sign_in_at
      from auth.users u
     where u.last_sign_in_at is not null
       and exists (
         select 1 from app.membership m
          where m.identity_id = u.id and m.org_id = $1 and m.deleted_at is null)
  $q$ using p_org;
end;
$$;

-- Deliberately still returns org_id, and still a table rather than a record: the call site reads it
-- with `select ... from`, and keeping the shape means the only edit there is the argument.
create or replace function app.platform_org_activity(p_org uuid)
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
      join app.platform_identity_activity(p_org) a on a.identity_id = m.identity_id
     where m.org_id = p_org and m.status = 'active' and m.deleted_at is null
     group by m.org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The call site
-- ---------------------------------------------------------------------------
-- Re-declared in full because plpgsql has no way to patch two lines of a body. Everything below is
-- 0050's, character for character, EXCEPT the two calls that now carry p_org. Said out loud because
-- this is the manoeuvre that let 0074 reintroduce a fixed bug: the migrations are the source, and a
-- body copied from anywhere else — schema_all.sql above all — arrives with whatever it was missing.
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
        left join app.platform_identity_activity(p_org) a on a.identity_id = m.identity_id
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
         from app.platform_org_activity(p_org)),
      jsonb_build_object('last_sign_in_at', null, 'active_today', 0)),
    'import_batches', (select count(*) from app.import_batch where org_id = p_org),
    'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately. Operator-only, like their twins.
-- ---------------------------------------------------------------------------
revoke all on function app.platform_identity_activity(uuid) from public, anon, authenticated;
revoke all on function app.platform_org_activity(uuid)      from public, anon, authenticated;
grant execute on function app.platform_identity_activity(uuid) to authenticated, service_role;
grant execute on function app.platform_org_activity(uuid)      to authenticated, service_role;

select app.record_migration('0081', 'platform_activity_scope');
