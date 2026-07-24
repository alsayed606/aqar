-- 0034_notifications.sql
-- Sprint C / C-2: in-app operational notifications for the office (dues due-soon/overdue, contracts
-- expiring). DELIVERY CHANNELS (SMS/email) are intentionally NOT here — this is generation + storage
-- + in-app surfacing only; a channel plugs in later. All writes go through the SECURITY DEFINER
-- functions below, so there is no direct-write RLS surface (and no viewer-write concern).

create table if not exists app.notification (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references app.organization(id) on delete cascade,
  property_id  uuid references app.property(id) on delete cascade,  -- for scope filtering; NULL = org-level
  kind         text not null,          -- charge_due_soon | charge_overdue | contract_expiring
  entity_type  text,                   -- charge | contract
  entity_id    uuid,
  title        text not null,
  body         text,
  due_date     date,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists notification_org_unread_idx
  on app.notification (org_id, created_at desc) where read_at is null;
-- One notification per logical event → generation is idempotent (on conflict do nothing).
create unique index if not exists notification_dedupe on app.notification
  (org_id, kind,
   coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(due_date, '0001-01-01'::date));

alter table app.notification enable row level security;
grant select on app.notification to authenticated;
-- Reads respect property scope (NULL property = org-level, visible to any member). No write grant:
-- inserts/updates happen only via the DEFINER functions below.
create policy notification_select on app.notification for select
  using (app.has_property_access(org_id, property_id));

-- generate_notifications(org) — idempotent scan; returns the org's unread count.
create or replace function app.generate_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

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

-- mark_notifications_read(org, ids) — any active member may clear their org's notifications
-- (NULL ids = clear all). A personal UI action; routed through a DEFINER fn (no table write grant).
create or replace function app.mark_notifications_read(p_org uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.notification set read_at = now()
  where org_id = p_org and read_at is null and (p_ids is null or id = any(p_ids));
end;
$$;

revoke all on function app.generate_notifications(uuid) from public;
revoke all on function app.mark_notifications_read(uuid, uuid[]) from public;
grant execute on function app.generate_notifications(uuid) to authenticated, service_role;
grant execute on function app.mark_notifications_read(uuid, uuid[]) to authenticated, service_role;
