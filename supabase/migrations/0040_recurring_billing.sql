-- 0040_recurring_billing.sql
-- Sprint H: recurring auto-renew. Saves a Moyasar CARD TOKEN (a reference — never card data) at the
-- first on-session payment, then a daily scheduler charges it off-session at renewal. Dunning on
-- failure: attempts on day 0 / +2 / +5, then the subscription goes `past_due` (which subscription_active
-- already treats as locked — new creation blocked, data kept). Alerts reuse the 0038 email pipeline.

-- ---------------------------------------------------------------------------
-- Saved payment method — the token is an opaque Moyasar reference, NOT a PAN. brand/last4 are display.
-- ---------------------------------------------------------------------------
create table if not exists app.org_payment_method (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organization(id) on delete cascade,
  gateway     text not null default 'moyasar',
  token       text not null,                 -- Moyasar token reference (never card data)
  brand       text,
  last4       text,
  exp_month   int,
  exp_year    int,
  status      text not null default 'active' check (status in ('active','removed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists org_payment_method_one_active on app.org_payment_method (org_id) where status = 'active';

alter table app.org_payment_method enable row level security;
grant select on app.org_payment_method to authenticated;
drop policy if exists org_payment_method_select on app.org_payment_method;
create policy org_payment_method_select on app.org_payment_method for select
  using (app.is_org_admin(org_id));

-- Subscription gains the auto-renew + dunning state.
alter table app.org_subscription add column if not exists auto_renew        boolean not null default false;
alter table app.org_subscription add column if not exists payment_method_id uuid references app.org_payment_method(id);
alter table app.org_subscription add column if not exists dunning_attempts  int not null default 0;
alter table app.org_subscription add column if not exists next_charge_at    timestamptz;

-- Payment gains provenance + dunning attempt number.
alter table app.subscription_payment add column if not exists initiated_by text not null default 'user' check (initiated_by in ('user','auto'));
alter table app.subscription_payment add column if not exists attempt      int  not null default 0;

-- ---------------------------------------------------------------------------
-- Card management (org admin) and token storage (service_role from the webhook).
-- ---------------------------------------------------------------------------
create or replace function app.set_auto_renew(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_on and not exists (select 1 from app.org_payment_method where org_id = p_org and status = 'active') then
    raise exception 'NO_PAYMENT_METHOD: save a card first' using errcode = 'raise_exception';
  end if;
  update app.org_subscription set auto_renew = p_on where org_id = p_org;
end;
$$;

create or replace function app.remove_payment_method(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.org_payment_method set status = 'removed', updated_at = now() where org_id = p_org and status = 'active';
  update app.org_subscription set auto_renew = false, payment_method_id = null where org_id = p_org;
end;
$$;

-- Store a token captured at checkout (service_role, from the webhook) → enables auto-renew.
create or replace function app.save_payment_method(
  p_org uuid, p_token text, p_brand text default null, p_last4 text default null,
  p_exp_month int default null, p_exp_year int default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  update app.org_payment_method set status = 'removed', updated_at = now() where org_id = p_org and status = 'active';
  insert into app.org_payment_method (org_id, token, brand, last4, exp_month, exp_year)
  values (p_org, p_token, p_brand, p_last4, p_exp_month, p_exp_year)
  returning id into v_id;
  update app.org_subscription set payment_method_id = v_id, auto_renew = true where org_id = p_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler surface (service_role). claim_due_renewals atomically leases each due subscription
-- (FOR UPDATE SKIP LOCKED + push next_charge_at forward) and opens an 'auto' payment intent, so two
-- overlapping cron runs never double-charge. Due = auto_renew, active/past_due, has an active token,
-- and (next_charge_at ?? current_period_end) <= now.
-- ---------------------------------------------------------------------------
create or replace function app.claim_due_renewals(p_max int default 25)
returns table (intent_id uuid, org_id uuid, token text, amount_halalas bigint, plan_code text)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record; v_amt bigint; v_token text; v_intent uuid;
begin
  for r in
    select s.org_id, s.plan_code, s.dunning_attempts, s.payment_method_id
    from app.org_subscription s
    where s.auto_renew
      and s.status in ('active','past_due')
      and exists (select 1 from app.org_payment_method m where m.id = s.payment_method_id and m.status = 'active')
      and coalesce(s.next_charge_at, s.current_period_end) is not null
      and coalesce(s.next_charge_at, s.current_period_end) <= now()
    order by coalesce(s.next_charge_at, s.current_period_end)
    for update of s skip locked
    limit greatest(p_max, 0)
  loop
    select price_halalas into v_amt from app.plan where code = r.plan_code;
    select m.token into v_token from app.org_payment_method m where m.id = r.payment_method_id and m.status = 'active';
    -- Lease so a crashed run retries later, not immediately (resolved by apply/record_dunning_failure).
    update app.org_subscription set next_charge_at = now() + interval '1 hour' where org_subscription.org_id = r.org_id;
    insert into app.subscription_payment (org_id, plan_code, amount_halalas, currency, gateway, status, initiated_by, attempt)
    values (r.org_id, r.plan_code, v_amt, 'SAR', 'moyasar', 'initiated', 'auto', r.dunning_attempts + 1)
    returning id into v_intent;
    intent_id := v_intent; org_id := r.org_id; token := v_token; amount_halalas := v_amt; plan_code := r.plan_code;
    return next;
  end loop;
end;
$$;

-- Enqueue one notification's email deliveries (service_role; ungated core used by dunning/scheduler,
-- since there is no user session in the cron). Mirrors enqueue_email_deliveries for a single row.
create or replace function app.enqueue_notification_email(p_notification_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.id = p_notification_id
  on conflict (notification_id, channel, target) do nothing;
end;
$$;

-- record_dunning_failure — mark the attempt failed, advance the dunning schedule, and alert the office
-- (in-app + email). After the 3rd failed attempt → past_due (locked). service_role.
create or replace function app.record_dunning_failure(p_intent uuid, p_raw jsonb default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_org uuid; v_attempt int; v_note uuid;
begin
  select org_id, attempt into v_org, v_attempt from app.subscription_payment where id = p_intent;
  if v_org is null then
    raise exception 'PAYMENT_INTENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.subscription_payment set status = 'failed', raw = coalesce(p_raw, raw)
   where id = p_intent and status <> 'paid';
  update app.org_subscription set dunning_attempts = v_attempt where org_id = v_org;

  if v_attempt >= 3 then
    update app.org_subscription set status = 'past_due', next_charge_at = null where org_id = v_org;
    insert into app.notification (org_id, kind, title, body)
    values (v_org, 'subscription_past_due', 'أُوقف الاشتراك مؤقتاً',
            'تعذّر تجديد اشتراكك بعد عدة محاولات. حدّث بطاقتك أو ادفع يدوياً من صفحة الاشتراك لاستئناف الإنشاء.')
    on conflict do nothing
    returning id into v_note;
  else
    -- schedule the next attempt: after #1 wait 2 days (→ day 2), after #2 wait 3 days (→ day 5).
    update app.org_subscription
       set next_charge_at = now() + (case v_attempt when 1 then interval '2 days' else interval '3 days' end)
     where org_id = v_org;
    insert into app.notification (org_id, kind, entity_type, entity_id, title, body)
    values (v_org, 'billing_failed', 'subscription_payment', p_intent, 'تعذّر تجديد الاشتراك',
            'فشلت محاولة الدفع؛ سنعيد المحاولة تلقائياً. يرجى التأكد من رصيد البطاقة لتفادي إيقاف الحساب.')
    on conflict do nothing
    returning id into v_note;
  end if;

  if v_note is not null then
    perform app.enqueue_notification_email(v_note);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace apply_subscription_payment (0039) → additionally RESET the dunning state on any success
-- (manual or auto), so a recovered charge clears past_due and re-arms the next cycle from the new
-- period end. Everything else is unchanged.
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
    return;  -- idempotent no-op
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
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end,
         dunning_attempts = 0, next_charge_at = null
   where org_id = v_pay.org_id;
end;
$$;

-- Replace subscription_summary (0036) → expose auto_renew + the saved card (brand/last4) for the UI.
create or replace function app.subscription_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v jsonb;
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select jsonb_build_object(
    'plan_code',          s.plan_code,
    'plan_name',          pl.name_ar,
    'price_halalas',      pl.price_halalas,
    'status',             s.status,
    'active',             app.subscription_active(p_org),
    'trial_ends_at',      s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'auto_renew',         s.auto_renew,
    'card',               (select jsonb_build_object('brand', m.brand, 'last4', m.last4)
                             from app.org_payment_method m where m.org_id = p_org and m.status = 'active'),
    'limits', jsonb_build_object('properties', pl.max_properties, 'units', pl.max_units, 'members', pl.max_members),
    'usage',  jsonb_build_object(
      'properties', app.usage_count(p_org,'properties'),
      'units',      app.usage_count(p_org,'units'),
      'members',    app.usage_count(p_org,'members'))
  ) into v
  from app.org_subscription s
  join app.plan pl on pl.code = s.plan_code
  where s.org_id = p_org;
  return v;
end;
$$;

revoke all on function app.set_auto_renew(uuid, boolean)                        from public;
revoke all on function app.remove_payment_method(uuid)                          from public;
revoke all on function app.save_payment_method(uuid, text, text, text, int, int) from public;
revoke all on function app.claim_due_renewals(int)                              from public;
revoke all on function app.enqueue_notification_email(uuid)                     from public;
revoke all on function app.record_dunning_failure(uuid, jsonb)                  from public;
grant execute on function app.set_auto_renew(uuid, boolean)                     to authenticated, service_role;
grant execute on function app.remove_payment_method(uuid)                       to authenticated, service_role;
-- Webhook/scheduler-only surface: service_role exclusively.
grant execute on function app.save_payment_method(uuid, text, text, text, int, int) to service_role;
grant execute on function app.claim_due_renewals(int)                           to service_role;
grant execute on function app.enqueue_notification_email(uuid)                   to service_role;
grant execute on function app.record_dunning_failure(uuid, jsonb)                to service_role;
