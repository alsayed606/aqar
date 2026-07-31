-- 0051_platform_billing.sql
-- Sprint T-3 — the subscription and billing centres.
--
-- The plan catalog becomes editable from the console. 0036 already treated limits and prices as
-- DATA rather than schema ("tuning them needs no migration"), but there was no gated way to change
-- them, so in practice every price change was a migration. operator_upsert_plan closes that with the
-- usual contract: operator-gated, validated, audited. Lowering a limit never touches existing rows —
-- plan ceilings block NEW creation only (Charter ق-هـ) — and past revenue is safe because
-- subscription_event snapshots the price at the time (0048).
--
-- Everything else here is reporting over records we already keep. Three things the brief asked for
-- are NOT built, and no button was invented for them:
--   • Discounts/coupons — there is no discount model at all. Codes, percent-or-amount, expiry and
--     redemption tracking is its own subsystem; half of it would be worse than none.
--   • Platform tax invoices — we record what an office PAID us, we do not ISSUE them an invoice.
--     As a Saudi vendor we owe our customers a ZATCA tax invoice for subscription fees; that is a
--     real gap, and it is a feature, not a report.
--   • Refunds — the status enum has `refunded`, but marking a row refunded without calling the
--     gateway would be a lie told to our own books. Refunded payments are REPORTED here; issuing
--     one needs the Moyasar refund API and a webhook, which this migration deliberately does not fake.

-- ---------------------------------------------------------------------------
-- operator_upsert_plan — create or re-tune a plan. NULL limit = unlimited, which is why the limit
-- arguments cannot use NULL to mean "leave unchanged": the caller always sends the full row.
-- ---------------------------------------------------------------------------
create or replace function app.operator_upsert_plan(
  p_code           text,
  p_name_ar        text,
  p_price_halalas  bigint,
  p_max_properties int  default null,
  p_max_units      int  default null,
  p_max_members    int  default null,
  p_is_public      boolean default true,
  p_sort           int  default 0
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before app.plan;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_code !~ '^[a-z][a-z0-9_]{1,29}$' then
    raise exception 'INVALID_PLAN_CODE' using errcode = 'raise_exception';
  end if;
  if coalesce(nullif(btrim(p_name_ar), ''), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'raise_exception';
  end if;
  if p_price_halalas is null or p_price_halalas < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'raise_exception';
  end if;
  if coalesce(p_max_properties, 0) < 0 or coalesce(p_max_units, 0) < 0 or coalesce(p_max_members, 0) < 0 then
    raise exception 'INVALID_LIMIT' using errcode = 'raise_exception';
  end if;

  select * into v_before from app.plan where code = p_code;

  insert into app.plan (code, name_ar, price_halalas, max_properties, max_units, max_members, is_public, sort)
  values (p_code, btrim(p_name_ar), p_price_halalas, p_max_properties, p_max_units, p_max_members,
          coalesce(p_is_public, true), coalesce(p_sort, 0))
  on conflict (code) do update set
    name_ar        = excluded.name_ar,
    price_halalas  = excluded.price_halalas,
    max_properties = excluded.max_properties,
    max_units      = excluded.max_units,
    max_members    = excluded.max_members,
    is_public      = excluded.is_public,
    sort           = excluded.sort,
    updated_at     = now();

  -- A platform-wide change: no org owns it, so the audit row carries a null org (write_audit then
  -- records the identity without a membership, which is the marker of a platform action).
  perform app.write_audit(null, 'platform.plan_upsert', 'plan', null, jsonb_build_object(
    'code', p_code,
    'before', case when v_before.code is null then null else jsonb_build_object(
      'name_ar', v_before.name_ar, 'price_halalas', v_before.price_halalas,
      'max_properties', v_before.max_properties, 'max_units', v_before.max_units,
      'max_members', v_before.max_members, 'is_public', v_before.is_public) end,
    'after', jsonb_build_object(
      'name_ar', btrim(p_name_ar), 'price_halalas', p_price_halalas,
      'max_properties', p_max_properties, 'max_units', p_max_units,
      'max_members', p_max_members, 'is_public', coalesce(p_is_public, true))));
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_list_payments — every subscription payment on the platform, paged and filtered, with the
-- office it belongs to. Same paging contract as platform_list_orgs: total_count is the size of the
-- FILTERED set, repeated on each row.
-- ---------------------------------------------------------------------------
create or replace function app.platform_list_payments(
  p_search text default null,
  p_status app.subscription_payment_status default null,
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  id uuid, org_id uuid, org_name text, plan_code text,
  amount_halalas bigint, currency text, gateway text, gateway_payment_id text,
  status app.subscription_payment_status,
  period_start timestamptz, period_end timestamptz,
  created_at timestamptz, paid_at timestamptz,
  failure_reason text, total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select sp.*, o.name as org_name
        from app.subscription_payment sp
        join app.organization o on o.id = sp.org_id
       where (p_status is null or sp.status = p_status)
         and (p_search is null
              or o.name ilike '%' || p_search || '%'
              or sp.gateway_payment_id ilike '%' || p_search || '%')
    )
    select m.id, m.org_id, m.org_name, m.plan_code,
           m.amount_halalas, m.currency, m.gateway, m.gateway_payment_id,
           m.status, m.period_start, m.period_end, m.created_at, m.paid_at,
           -- The gateway owns this shape; read the usual places and say nothing when none of them
           -- carry a message rather than inventing a reason.
           coalesce(m.raw->>'message', m.raw#>>'{source,message}', m.raw->>'error'),
           count(*) over ()
      from matched m
     order by m.created_at desc
     limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_billing_health(days) — what the gateway has actually been doing for us. This is derived
-- from our own records; a live "is Moyasar up" probe would need their API and is not claimed here.
-- ---------------------------------------------------------------------------
create or replace function app.platform_billing_health(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_paid   int;
  v_failed int;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select count(*) filter (where status = 'paid'), count(*) filter (where status = 'failed')
    into v_paid, v_failed
    from app.subscription_payment where created_at >= v_since;

  return jsonb_build_object(
    'window_days', greatest(coalesce(p_days, 30), 1),
    'paid_count', v_paid,
    'failed_count', v_failed,
    -- Undefined, not 100%, when nothing has been attempted: a rate over zero attempts is not a fact.
    'success_rate', case when (v_paid + v_failed) > 0
                         then round(v_paid::numeric / (v_paid + v_failed), 4) end,
    'paid_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                      where status = 'paid' and created_at >= v_since),
    'refunded_count', (select count(*) from app.subscription_payment
                        where status = 'refunded' and created_at >= v_since),
    'refunded_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                          where status = 'refunded' and created_at >= v_since),
    'initiated_stale', (select count(*) from app.subscription_payment
                         where status = 'initiated' and created_at < now() - interval '24 hours'),
    'last_paid_at', (select max(paid_at) from app.subscription_payment where status = 'paid'),
    'last_failed_at', (select max(created_at) from app.subscription_payment where status = 'failed'),
    'failure_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc), '[]'::jsonb)
        from (
          select coalesce(raw->>'message', raw#>>'{source,message}', raw->>'error') as reason,
                 count(*)::int as n
            from app.subscription_payment
           where status = 'failed' and created_at >= v_since
           group by 1 limit 8
        ) f),
    'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_subscription_center() — the lifecycle view: who is on trial, what renews soon, who is
-- armed for auto-renew and who is not, and who has been stopped.
-- ---------------------------------------------------------------------------
create or replace function app.platform_subscription_center()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return jsonb_build_object(
    'trials', (
      select jsonb_build_object(
        'total',       count(*),
        'expiring_7d', count(*) filter (where trial_ends_at between now() and now() + interval '7 days'),
        'expiring_30d',count(*) filter (where trial_ends_at between now() and now() + interval '30 days'),
        -- Still flagged `trialing` but the date has passed: entitlement is already off and nobody
        -- has decided what happens next. These are the ones a human needs to look at.
        'lapsed',      count(*) filter (where trial_ends_at is not null and trial_ends_at < now()))
      from app.org_subscription where status = 'trialing'),
    'renewals', (
      select jsonb_build_object(
        'due_7d',  count(*) filter (where current_period_end between now() and now() + interval '7 days'),
        'due_30d', count(*) filter (where current_period_end between now() and now() + interval '30 days'),
        'auto_renew_on',  count(*) filter (where auto_renew),
        'auto_renew_off', count(*) filter (where not auto_renew))
      from app.org_subscription where status = 'active'),
    -- An active subscription with no saved card cannot renew itself; it will lapse silently unless
    -- someone calls. That is the single most actionable list in this payload.
    'active_without_card', (
      select count(*) from app.org_subscription s
       where s.status = 'active'
         and not exists (select 1 from app.org_payment_method m
                          where m.org_id = s.org_id and m.status = 'active')),
    'stopped', jsonb_build_object(
      'suspended',    (select count(*) from app.org_subscription where status = 'suspended'),
      'past_due',     (select count(*) from app.org_subscription where status = 'past_due'),
      'canceled',     (select count(*) from app.org_subscription where status = 'canceled'),
      'canceled_30d', (select count(distinct org_id) from app.subscription_event
                        where kind = 'status_changed' and to_status = 'canceled'
                          and created_at >= now() - interval '30 days')),
    'generated_at', now());
end;
$$;

revoke all on function app.operator_upsert_plan(text, text, bigint, int, int, int, boolean, int) from public;
revoke all on function app.platform_list_payments(text, app.subscription_payment_status, int, int) from public;
revoke all on function app.platform_billing_health(int)      from public;
revoke all on function app.platform_subscription_center()    from public;
grant execute on function app.operator_upsert_plan(text, text, bigint, int, int, int, boolean, int) to authenticated, service_role;
grant execute on function app.platform_list_payments(text, app.subscription_payment_status, int, int) to authenticated, service_role;
grant execute on function app.platform_billing_health(int)   to authenticated, service_role;
grant execute on function app.platform_subscription_center() to authenticated, service_role;
