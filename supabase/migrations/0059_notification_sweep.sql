-- 0059_notification_sweep.sql
-- Launch sprint: move notification generation off page render and onto Cron.
--
-- The defect: app/app/notifications/page.tsx called generate_notifications + enqueue_email_deliveries
-- during render. Two consequences, both bad:
--   * every view of that page performed write work, on a page that is read far more than it changes;
--   * an office whose staff never open the page generated NO notifications and queued NO email at
--     all — so the reminder that a rent charge is overdue depended on somebody already looking.
--
-- Cron cannot simply call the existing functions: both are SECURITY DEFINER gated on
-- app.has_org_access(p_org), which resolves against auth.uid(). service_role has no membership, so
-- every call would raise FORBIDDEN. The gate is correct and stays; what is needed is to separate the
-- WORK from the AUTHORISATION so the same work can be reached by two callers with different rights.
--
-- Shape: *_for(org) does the work with no gate and is reachable only by service_role; the original
-- names keep their gate and delegate. One body, two doors.
--
-- 0053 rule: migration 0001 declares
--   alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;
-- so `revoke from public` does NOT close a new function. anon and authenticated must be revoked by
-- name, or the ungated *_for functions would be callable by any signed-in user for ANY org.

-- ---------------------------------------------------------------------------
-- 1. The work, without the gate. NEVER grant these to authenticated.
-- ---------------------------------------------------------------------------
create or replace function app.generate_notifications_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  -- Charges due within 7 days, not yet settled.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_due_soon', 'charge', c.id,
         'استحقاق قريب', 'دفعة تستحق بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and not cb.is_settled
    and c.due_date >= current_date and c.due_date <= current_date + 7
  on conflict do nothing;

  -- Overdue unsettled charges.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_overdue', 'charge', c.id,
         'دفعة متأخرة', 'دفعة متأخرة استحقّت بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and cb.is_overdue and not cb.is_settled
  on conflict do nothing;

  -- Active contracts ending within 30 days with no successor renewal yet.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select ct.org_id, ct.property_id, 'contract_expiring', 'contract', ct.id,
         'عقد ينتهي قريباً', 'العقد ' || ct.contract_number || ' ينتهي بتاريخ ' || ct.end_date, ct.end_date
  from app.contract ct
  where ct.org_id = p_org and ct.status = 'active' and ct.deleted_at is null
    and ct.end_date >= current_date and ct.end_date <= current_date + 30
    and not exists (
      select 1 from app.contract r
      where r.renewed_from_contract_id = ct.id and r.deleted_at is null and r.status <> 'cancelled')
  on conflict do nothing;

  return (select count(*)::int from app.notification where org_id = p_org and read_at is null);
end;
$$;

create or replace function app.enqueue_email_deliveries_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.generate_notifications_for(uuid)    from public, anon, authenticated;
revoke all on function app.enqueue_email_deliveries_for(uuid)  from public, anon, authenticated;
grant execute on function app.generate_notifications_for(uuid)   to service_role;
grant execute on function app.enqueue_email_deliveries_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The member-facing names keep their gate and delegate. Same behaviour as before for any caller
-- that already had the right; the office "refresh" button still works.
-- ---------------------------------------------------------------------------
create or replace function app.generate_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return app.generate_notifications_for(p_org);
end;
$$;

create or replace function app.enqueue_email_deliveries(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return app.enqueue_email_deliveries_for(p_org);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The sweep the Cron job calls. Skips soft-deleted offices and those whose subscription is no
-- longer live — a cancelled office should stop receiving reminders, not keep being e-mailed.
-- ---------------------------------------------------------------------------
create or replace function app.sweep_notifications()
-- `unread` is the total unread count across swept offices, not the number created this run —
-- generate_notifications_for returns a standing count, and the inserts are ON CONFLICT DO NOTHING.
returns table (orgs int, unread int, queued int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record;
  v_orgs int := 0;
  v_unread int := 0;
  v_queued int := 0;
begin
  for r in
    select o.id
      from app.organization o
      left join app.org_subscription s on s.org_id = o.id
     where o.deleted_at is null
       and coalesce(s.status, 'trialing') in ('trialing', 'active', 'past_due', 'comped')
  loop
    v_orgs   := v_orgs + 1;
    v_unread := v_unread + coalesce(app.generate_notifications_for(r.id), 0);
    v_queued := v_queued + coalesce(app.enqueue_email_deliveries_for(r.id), 0);
  end loop;

  return query select v_orgs, v_unread, v_queued;
end;
$$;

revoke all on function app.sweep_notifications() from public, anon, authenticated;
grant execute on function app.sweep_notifications() to service_role;
