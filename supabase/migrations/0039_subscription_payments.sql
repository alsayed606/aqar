-- 0039_subscription_payments.sql
-- Sprint G: close the billing loop. Automated subscription payment via Moyasar (hosted checkout —
-- card data NEVER touches our servers) plus a thin platform-operator surface for manual overrides.
--
-- Flow: the office (org admin) starts a payment → create_subscription_payment records an intent →
-- the app creates a Moyasar invoice and redirects to the hosted page → Moyasar's webhook calls
-- apply_subscription_payment which ACTIVATES org_subscription (Sprint D) and extends the period.
-- apply/mark are service_role-ONLY and idempotent (the gateway retries webhooks).

do $$ begin
  if not exists (select 1 from pg_type where typname='subscription_payment_status' and typnamespace='app'::regnamespace) then
    create type app.subscription_payment_status as enum ('initiated','paid','failed','refunded');
  end if;
end $$;

create table if not exists app.subscription_payment (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references app.organization(id) on delete cascade,
  plan_code           text not null references app.plan(code),
  amount_halalas      bigint not null,
  currency            text not null default 'SAR',
  gateway             text not null default 'moyasar',
  gateway_payment_id  text unique,                          -- Moyasar invoice/payment id (set at apply)
  status              app.subscription_payment_status not null default 'initiated',
  period_start        timestamptz,
  period_end          timestamptz,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists subscription_payment_org_idx on app.subscription_payment (org_id, created_at desc);

alter table app.subscription_payment enable row level security;
grant select on app.subscription_payment to authenticated;
-- Payment history is admin-only; writes go through the DEFINER functions below.
drop policy if exists subscription_payment_select on app.subscription_payment;
create policy subscription_payment_select on app.subscription_payment for select
  using (app.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- create_subscription_payment(org, plan) — org admin records a payment intent for a purchasable plan.
-- ---------------------------------------------------------------------------
create or replace function app.create_subscription_payment(p_org uuid, p_plan text)
returns app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_plan app.plan;
  v_row  app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_plan from app.plan where code = p_plan;
  if v_plan.code is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not v_plan.is_public or v_plan.price_halalas <= 0 then
    raise exception 'PLAN_NOT_PURCHASABLE: % is not self-serve purchasable', p_plan using errcode = 'raise_exception';
  end if;

  insert into app.subscription_payment (org_id, plan_code, amount_halalas, currency, gateway, status)
  values (p_org, v_plan.code, v_plan.price_halalas, 'SAR', 'moyasar', 'initiated')
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_subscription_payment(intent, gateway_id, raw) — the money path. Idempotent: a second call for
-- an already-paid intent is a no-op (the gateway may resend the webhook). Activates the subscription
-- and extends the period by one month from max(now, current period end) so renewals stack correctly.
-- service_role ONLY.
-- ---------------------------------------------------------------------------
create or replace function app.apply_subscription_payment(p_intent uuid, p_gateway_id text, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_pay app.subscription_payment;
  v_end timestamptz;
begin
  select * into v_pay from app.subscription_payment where id = p_intent for update;
  if v_pay.id is null then
    raise exception 'PAYMENT_INTENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    return;  -- already applied → idempotent no-op
  end if;

  v_end := greatest(now(), coalesce((select current_period_end from app.org_subscription where org_id = v_pay.org_id), now()))
           + interval '1 month';

  update app.subscription_payment
     set status = 'paid', paid_at = now(),
         gateway_payment_id = coalesce(p_gateway_id, gateway_payment_id),
         raw = coalesce(p_raw, raw),
         period_start = now(), period_end = v_end
   where id = p_intent;

  update app.org_subscription
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end
   where org_id = v_pay.org_id;
end;
$$;

-- mark a payment failed (non-terminal for already-paid intents).
create or replace function app.mark_subscription_payment_failed(p_intent uuid, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.subscription_payment
     set status = 'failed', raw = coalesce(p_raw, raw)
   where id = p_intent and status <> 'paid';
end;
$$;

revoke all on function app.create_subscription_payment(uuid, text)          from public;
revoke all on function app.apply_subscription_payment(uuid, text, jsonb)     from public;
revoke all on function app.mark_subscription_payment_failed(uuid, jsonb)     from public;
grant execute on function app.create_subscription_payment(uuid, text)        to authenticated, service_role;
-- Webhook-only surface: service_role exclusively.
grant execute on function app.apply_subscription_payment(uuid, text, jsonb)  to service_role;
grant execute on function app.mark_subscription_payment_failed(uuid, jsonb)  to service_role;

-- ---------------------------------------------------------------------------
-- Platform operator — a super-admin ABOVE all orgs (the manual Sprint-D levers, now via a UI). The
-- table is DEFINER-only (no RLS policy, no grant); seed your identity by SQL after applying:
--   insert into app.platform_operator(identity_id) values ('<your-auth-uid>');
-- ---------------------------------------------------------------------------
create table if not exists app.platform_operator (
  identity_id uuid primary key references app.identity(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table app.platform_operator enable row level security;  -- no policy → no direct access; DEFINER only

create or replace function app.is_platform_operator() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (select 1 from app.platform_operator where identity_id = auth.uid());
$$;

-- operator_list_orgs() — every org with its subscription snapshot and live usage.
create or replace function app.operator_list_orgs()
returns table (
  org_id uuid, org_name text, plan_code text, status app.subscription_status,
  trial_ends_at timestamptz, current_period_end timestamptz,
  properties int, units int, members int, created_at timestamptz
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select o.id, o.name, s.plan_code, s.status, s.trial_ends_at, s.current_period_end,
           app.usage_count(o.id,'properties'), app.usage_count(o.id,'units'), app.usage_count(o.id,'members'),
           o.created_at
    from app.organization o
    left join app.org_subscription s on s.org_id = o.id
    where o.deleted_at is null
    order by o.created_at desc;
end;
$$;

-- operator_set_subscription(...) — the manual overrides (comp / extend trial / change plan or status).
-- NULL args leave the current value unchanged.
create or replace function app.operator_set_subscription(
  p_org uuid, p_plan text default null, p_status app.subscription_status default null,
  p_trial_ends_at timestamptz default null, p_period_end timestamptz default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_plan is not null and not exists (select 1 from app.plan where code = p_plan) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  update app.org_subscription
     set plan_code          = coalesce(p_plan, plan_code),
         status             = coalesce(p_status, status),
         trial_ends_at      = coalesce(p_trial_ends_at, trial_ends_at),
         current_period_end = coalesce(p_period_end, current_period_end),
         notes              = coalesce(p_notes, notes)
   where org_id = p_org;
end;
$$;

-- operator_list_payments(org) — payment history for one org.
create or replace function app.operator_list_payments(p_org uuid)
returns setof app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query select * from app.subscription_payment where org_id = p_org order by created_at desc;
end;
$$;

revoke all on function app.is_platform_operator()                                          from public;
revoke all on function app.operator_list_orgs()                                            from public;
revoke all on function app.operator_set_subscription(uuid, text, app.subscription_status, timestamptz, timestamptz, text) from public;
revoke all on function app.operator_list_payments(uuid)                                    from public;
grant execute on function app.is_platform_operator()                                       to authenticated, service_role;
grant execute on function app.operator_list_orgs()                                         to authenticated, service_role;
grant execute on function app.operator_set_subscription(uuid, text, app.subscription_status, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function app.operator_list_payments(uuid)                                 to authenticated, service_role;
