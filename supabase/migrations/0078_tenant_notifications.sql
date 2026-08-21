-- 0078_tenant_notifications.sql
-- The other half of a maintenance request: telling the person who opened it what happened.
--
-- 0072 gave the tenant a way to report a fault and gave the office a way to work it. Between those
-- two the tenant heard nothing — not when the work started, not when it was closed, not when it was
-- refused. So they reopen the portal each day to check, or they phone the office: the two things the
-- module exists to prevent.
--
-- Everything needed to send is already here — an outbox with idempotency and backoff (0038), a
-- drainer (0059), a provider (8 Aug). What was missing is that a notification has always been an
-- OFFICE object: app.notification is read through has_property_access, and a tenant is not a member,
-- so no row in that table has ever been readable by one. This file makes a notification able to name
-- a person instead of an office, and leaves every existing row exactly as it was.

-- ---------------------------------------------------------------------------
-- 1. Two columns
-- ---------------------------------------------------------------------------
alter table app.notification
  -- NULL means what every row means today: this belongs to the office. Not null means it is addressed
  -- to that party, and the office does not see it — the office is the sender, and its bell should not
  -- ring with its own outgoing mail.
  add column if not exists recipient_party_id uuid references app.party(id) on delete cascade,
  -- Where the message points. The drainer used to hardcode /app/notifications, which is a staff page:
  -- a tenant sent there meets a wall. The producer knows the destination; the drainer should not have
  -- to learn about parties and portals to find it.
  add column if not exists link_path text;

create index if not exists notification_recipient_idx
  on app.notification (recipient_party_id, created_at desc)
  where recipient_party_id is not null;

-- The dedupe index is what makes generation idempotent. It must now separate rows by addressee, or
-- one person's notice would silently suppress another's for the same entity and kind.
drop index if exists app.notification_dedupe;
create unique index if not exists notification_dedupe on app.notification
  (org_id, kind,
   coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(due_date, '0001-01-01'::date),
   coalesce(recipient_party_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- 2. Who reads what
-- ---------------------------------------------------------------------------
-- The office keeps exactly the reach it had, minus rows addressed to someone else.
drop policy if exists notification_select on app.notification;
create policy notification_select on app.notification for select
  using (recipient_party_id is null and app.has_property_access(org_id, property_id));

-- SECURITY DEFINER for the same reason app.tenant_is_mine is (0029): a policy predicate runs as the
-- querying user, and app.party is readable only by members of its org. A tenant asking "is this row
-- mine?" through a plain EXISTS would be answered "no" by a policy hiding their own record — the
-- notice would be addressed to them and invisible to them.
create or replace function app.party_is_mine(p_party uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.party p
    where p.id = p_party and p.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

-- And the addressee reads their own, through the same identity link the portal already trusts.
drop policy if exists notification_recipient_select on app.notification;
create policy notification_recipient_select on app.notification for select
  using (recipient_party_id is not null and app.party_is_mine(recipient_party_id));

-- ---------------------------------------------------------------------------
-- 3. Enqueue learns the second shape
-- ---------------------------------------------------------------------------
-- One function, one call site, two audiences. Splitting it into enqueue_office_email and
-- enqueue_party_email would mean every future producer has to know which one it is talking to; the
-- notification already says.
create or replace function app.enqueue_notification_email(p_notification_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_party uuid;
begin
  select n.recipient_party_id into v_party from app.notification n where n.id = p_notification_id;

  if v_party is not null then
    -- A party with no email simply gets no row. Silence beats a delivery aimed at nothing, which
    -- would burn three attempts and land in the failure count as if the provider were at fault.
    insert into app.notification_delivery (org_id, notification_id, channel, target)
    select n.org_id, n.id, 'email', p.email
    from app.notification n
    join app.party p on p.id = n.recipient_party_id
    where n.id = p_notification_id
      and p.email is not null
      and btrim(p.email) <> ''
      and p.deleted_at is null
    on conflict (notification_id, channel, target) do nothing;
    return;
  end if;

  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.id = p_notification_id
  on conflict (notification_id, channel, target) do nothing;
end;
$$;

-- The bulk sibling has the same blind spot, and it is the dangerous one: it sweeps every unread
-- notification in the org and mails it to every member. Left alone, the office would receive a copy
-- of every message written to a tenant — signed by the office, addressed to the office.
--
-- Only the `_for` twin is redeclared here. 0059 made the gated names thin wrappers that delegate to
-- these; rewriting a wrapper to hold the query again would silently undo that delegation, which is
-- exactly how 0074 reintroduced a bug by copying from schema_all.sql. The migrations are the source.
create or replace function app.enqueue_email_deliveries_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null and n.recipient_party_id is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- And the unread figure the sweep reports to the health page. The three inserts below are 0059's,
-- unchanged; only the closing count is. An operator gauge that counts messages written TO tenants as
-- office work waiting to be done is a gauge that lies — the same objection 0070 raised about a queue
-- depth padded with rows nobody would ever send.
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

  return (select count(*)::int from app.notification
           where org_id = p_org and read_at is null and recipient_party_id is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The trigger
-- ---------------------------------------------------------------------------
-- A trigger rather than a line inside the office's action: the status is changed by a plain UPDATE
-- through RLS, so there is no single function to amend, and any future path — an import, a bulk
-- close, a screen not yet written — would have to remember. This cannot be forgotten.
--
-- The resolution note is deliberately NOT sent (decision, 20 Aug 2026). The office has been writing
-- it since 0072 knowing the tenant cannot see it — tenant_portal_maintenance does not return it — so
-- it may well carry what was never written to be read. Publishing it now would change the meaning of
-- a field already filled in confidence.
create or replace function app.tg_maintenance_notify_tenant() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_note   uuid;
  v_tenant uuid;
  v_unit   text;
  v_title  text;
  v_body   text;
begin
  -- Nobody to tell: reported by staff, or the party record was erased under PDPL.
  if new.reported_by_party_id is null then
    return new;
  end if;

  select
    case new.status
      when 'in_progress' then 'بدأ العمل على طلبك'
      when 'resolved'    then 'أُغلق طلبك'
      when 'cancelled'   then 'لم يُقبل طلبك'
    end
  into v_title;

  -- Back to 'open' is an administrative correction, not news. Saying nothing is the right amount.
  if v_title is null then
    return new;
  end if;

  select u.unit_number into v_unit from app.unit u where u.id = new.unit_id;

  -- The portal is addressed by tenant, not by party. A party that is not a tenant of this org has no
  -- portal to point at, and the message goes without a link rather than to a broken one.
  select t.id into v_tenant
  from app.tenant t
  where t.party_id = new.reported_by_party_id
    and t.org_id = new.org_id
    and t.deleted_at is null
  limit 1;

  v_body := 'طلب الصيانة ' || coalesce(new.request_no, '') || ' — وحدة ' || coalesce(v_unit, '')
         || case new.status
              when 'resolved'  then '. إن لم يُعالَج فعلاً فأبلغ المكتب.'
              when 'cancelled' then '. للاستفسار تواصل مع المكتب.'
              else '.'
            end;

  insert into app.notification (
    org_id, property_id, kind, entity_type, entity_id, title, body,
    recipient_party_id, link_path
  )
  values (
    new.org_id, new.property_id, 'maintenance_' || new.status::text,
    'maintenance_request', new.id, v_title, v_body,
    new.reported_by_party_id,
    case when v_tenant is not null then '/portal/tenant/' || v_tenant::text end
  )
  on conflict do nothing
  returning id into v_note;

  -- Null when the same transition was already announced: dedupe did its job, and re-enqueueing would
  -- be a second copy of a message already sent.
  if v_note is not null then
    perform app.enqueue_notification_email(v_note);
  end if;

  return new;
end;
$$;

drop trigger if exists maintenance_notify_tenant on app.maintenance_request;
create trigger maintenance_notify_tenant
  after update of status on app.maintenance_request
  for each row
  when (old.status is distinct from new.status)
  execute function app.tg_maintenance_notify_tenant();

-- ---------------------------------------------------------------------------
-- 5. Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
-- enqueue stays service_role-only exactly as 0053 left it; the trigger reaches it as DEFINER.
revoke all on function app.enqueue_notification_email(uuid)      from public, anon, authenticated;
revoke all on function app.tg_maintenance_notify_tenant()        from public, anon, authenticated;
revoke all on function app.party_is_mine(uuid)                   from public, anon, authenticated;
grant execute on function app.enqueue_notification_email(uuid)   to service_role;
-- The policy calls it as the querying user, so authenticated must be able to.
grant execute on function app.party_is_mine(uuid)                to authenticated, service_role;

select app.record_migration('0078', 'tenant_notifications');
