-- 0062_offline_subscription_payment.sql
-- Paying for a subscription by bank transfer or cash.
--
-- Why: the launch was postponed because electronic payment is not ready. Without an offline path
-- there is no way to onboard a paying office at all, so this is not a convenience feature — it is
-- the only route to revenue until Moyasar goes live, and it has to work alongside it afterwards.
--
-- The shape follows the money, not the UI. An offline payment is the SAME subscription_payment row
-- an online one produces; only who confirms it differs. Moyasar's webhook confirms a card payment;
-- a human operator confirms a transfer after seeing it on the bank statement. Modelling it as a
-- second kind of payment table would have split subscription history in two and broken every
-- report, MRR calculation and audit view that already reads subscription_payment.

-- ---------------------------------------------------------------------------
-- 1. What an offline payment adds to the row.
-- ---------------------------------------------------------------------------
alter table app.subscription_payment add column if not exists method       text;   -- bank_transfer | cash
alter table app.subscription_payment add column if not exists reference    text;   -- what the office typed
alter table app.subscription_payment add column if not exists review_note  text;   -- operator's note on confirm/reject
alter table app.subscription_payment add column if not exists confirmed_by uuid references app.identity(id);
alter table app.subscription_payment add column if not exists confirmed_at timestamptz;

alter table app.subscription_payment drop constraint if exists subscription_payment_method_chk;
alter table app.subscription_payment add constraint subscription_payment_method_chk
  check (method is null or method in ('bank_transfer', 'cash'));

-- Answers "what is waiting for me to confirm" without scanning history.
create index if not exists subscription_payment_pending_idx
  on app.subscription_payment (created_at desc)
  where gateway = 'offline' and status = 'initiated';

-- Where the office is told to send the money. Known keys only — app.operator_set_setting refuses
-- anything it has not seen, so they are seeded here rather than invented at write time.
insert into app.platform_setting (key, value, label_ar) values
  ('bank_name',         '""'::jsonb, 'اسم البنك'),
  ('bank_account_name', '""'::jsonb, 'اسم صاحب الحساب'),
  ('bank_iban',         '""'::jsonb, 'رقم الآيبان'),
  ('offline_payment_note', '""'::jsonb, 'ملاحظة تظهر للمكتب عند التحويل')
on conflict (key) do nothing;

-- Readable by any signed-in office admin: this is OUR account number for receiving money, published
-- on purpose. It is not the platform settings surface, which stays operator-only.
create or replace function app.subscription_bank_details() returns jsonb
language sql stable security definer set search_path = app, pg_temp as $$
  select jsonb_build_object(
    'bank_name',         coalesce((select value from app.platform_setting where key = 'bank_name'), '""'::jsonb),
    'bank_account_name', coalesce((select value from app.platform_setting where key = 'bank_account_name'), '""'::jsonb),
    'bank_iban',         coalesce((select value from app.platform_setting where key = 'bank_iban'), '""'::jsonb),
    'note',              coalesce((select value from app.platform_setting where key = 'offline_payment_note'), '""'::jsonb)
  );
$$;
revoke all on function app.subscription_bank_details() from public, anon;
grant execute on function app.subscription_bank_details() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The office declares a transfer it has already made.
-- This creates an INTENT, never an active subscription. Nothing is granted until a human confirms
-- the money arrived — otherwise anyone could type a reference and unlock a paid plan.
-- ---------------------------------------------------------------------------
create or replace function app.request_offline_payment(p_org uuid, p_plan text, p_method text, p_reference text)
returns app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_plan app.plan;
  v_row  app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_method not in ('bank_transfer', 'cash') then
    raise exception 'INVALID_METHOD' using errcode = 'raise_exception';
  end if;

  select * into v_plan from app.plan where code = p_plan;
  if v_plan.code is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not v_plan.is_public or v_plan.price_halalas <= 0 then
    raise exception 'PLAN_NOT_PURCHASABLE: % is not self-serve purchasable', p_plan using errcode = 'raise_exception';
  end if;

  -- One open request at a time. Otherwise a confused office files five, and the operator has to
  -- work out which transfer matches which row.
  if exists (select 1 from app.subscription_payment
              where org_id = p_org and gateway = 'offline' and status = 'initiated') then
    raise exception 'OFFLINE_REQUEST_PENDING: a transfer is already awaiting confirmation'
      using errcode = 'raise_exception';
  end if;

  insert into app.subscription_payment (org_id, plan_code, amount_halalas, gateway, method, reference, status)
  values (p_org, v_plan.code, v_plan.price_halalas, 'offline', p_method, nullif(btrim(p_reference), ''), 'initiated')
  returning * into v_row;

  perform app.write_audit(p_org, 'subscription.offline_requested', 'subscription_payment', v_row.id,
                          jsonb_build_object('plan', v_plan.code, 'method', p_method, 'reference', p_reference));
  return v_row;
end;
$$;

-- The office's own view of what it is waiting on.
create or replace function app.pending_offline_payment(p_org uuid)
returns app.subscription_payment
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_row app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select * into v_row from app.subscription_payment
   where org_id = p_org and gateway = 'offline' and status = 'initiated'
   order by created_at desc limit 1;
  return v_row;
end;
$$;

-- Cancelling is the office's to do — they may have typed the wrong reference, or changed plan.
create or replace function app.cancel_offline_payment(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.subscription_payment
     set status = 'failed', review_note = 'ألغاه المكتب'
   where org_id = p_org and gateway = 'offline' and status = 'initiated';
  perform app.write_audit(p_org, 'subscription.offline_cancelled', 'organization', p_org, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The operator side. ADR-0006: every platform function raises FORBIDDEN first.
-- ---------------------------------------------------------------------------
create or replace function app.platform_offline_payments()
returns table (
  id uuid, org_id uuid, org_name text, plan_code text, amount_halalas bigint,
  method text, reference text, created_at timestamptz
)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select sp.id, sp.org_id, o.name, sp.plan_code, sp.amount_halalas,
           sp.method, sp.reference, sp.created_at
      from app.subscription_payment sp
      join app.organization o on o.id = sp.org_id
     where sp.gateway = 'offline' and sp.status = 'initiated'
     order by sp.created_at;
end;
$$;

-- Confirming is what actually grants the plan. It reuses the same period arithmetic as the online
-- path so a transfer-paying office and a card-paying office end up on identical subscription rows.
create or replace function app.operator_confirm_offline_payment(p_payment uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_pay app.subscription_payment;
  v_end timestamptz;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_pay from app.subscription_payment where id = p_payment for update;
  if v_pay.id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.gateway <> 'offline' then
    raise exception 'NOT_AN_OFFLINE_PAYMENT' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    return;  -- idempotent: a double click must not extend the period twice
  end if;

  v_end := greatest(now(), coalesce((select current_period_end from app.org_subscription where org_id = v_pay.org_id), now()))
           + interval '1 month';

  update app.subscription_payment
     set status = 'paid', paid_at = now(), period_start = now(), period_end = v_end,
         confirmed_by = auth.uid(), confirmed_at = now(), review_note = p_note
   where id = p_payment;

  update app.org_subscription
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end
   where org_id = v_pay.org_id;

  perform app.write_audit(v_pay.org_id, 'platform.confirm_offline_payment', 'subscription_payment', p_payment,
                          jsonb_build_object('plan', v_pay.plan_code, 'amount_halalas', v_pay.amount_halalas,
                                             'method', v_pay.method, 'reference', v_pay.reference, 'note', p_note));
end;
$$;

create or replace function app.operator_reject_offline_payment(p_payment uuid, p_reason text)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pay app.subscription_payment;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select * into v_pay from app.subscription_payment where id = p_payment for update;
  if v_pay.id is null or v_pay.gateway <> 'offline' then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    raise exception 'ALREADY_CONFIRMED: reverse it with a refund, not a rejection'
      using errcode = 'raise_exception';
  end if;

  update app.subscription_payment
     set status = 'failed', review_note = p_reason, confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_payment;

  perform app.write_audit(v_pay.org_id, 'platform.reject_offline_payment', 'subscription_payment', p_payment,
                          jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function app.request_offline_payment(uuid, text, text, text)   from public;
revoke all on function app.pending_offline_payment(uuid)                     from public;
revoke all on function app.cancel_offline_payment(uuid)                      from public;
revoke all on function app.platform_offline_payments()                       from public;
revoke all on function app.operator_confirm_offline_payment(uuid, text)      from public;
revoke all on function app.operator_reject_offline_payment(uuid, text)       from public;
grant execute on function app.request_offline_payment(uuid, text, text, text) to authenticated, service_role;
grant execute on function app.pending_offline_payment(uuid)                   to authenticated, service_role;
grant execute on function app.cancel_offline_payment(uuid)                    to authenticated, service_role;
grant execute on function app.platform_offline_payments()                     to authenticated, service_role;
grant execute on function app.operator_confirm_offline_payment(uuid, text)    to authenticated, service_role;
grant execute on function app.operator_reject_offline_payment(uuid, text)     to authenticated, service_role;
