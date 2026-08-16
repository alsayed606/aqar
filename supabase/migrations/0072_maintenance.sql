-- 0072_maintenance.sql
-- طلبات الصيانة — the first thing in this product a TENANT may write.
--
-- Until now the tenant portal was read-only: a tenant could see their contracts, charges and
-- receipts, and nothing they did changed a row. A maintenance request breaks that, so the entry
-- point is deliberately narrow — ONE security-definer function that proves the tenant has an active
-- contract on the unit before it inserts. There is no `for insert` policy for tenants on the table
-- itself, because a policy is a door that a later, looser policy can widen by accident.
--
-- What this file does NOT do, on purpose:
--   * No vendor table. "شركة الصفا للصيانة" is text. A vendor table drags in their contracts,
--     price lists and ratings — a second module inside the first — and it should be extracted from
--     real names later, not guessed at now.
--   * cost_bearer records WHO pays; it posts nothing. Charging an owner for a repair touches the
--     management fee and the owner statement, and that is an accounting decision of its own.
--   * The owner portal is untouched. Owners do not see these rows (decision, 14 Aug 2026): their
--     portal answers about money, and opening it onto maintenance opens "why isn't it fixed yet".
--
-- A request is never deleted. `cancelled` carries a reason, because the row is the record of a
-- tenant's complaint and deleting it erases what the office may later be asked about.

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'maintenance_status' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_status as enum ('open', 'in_progress', 'resolved', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'maintenance_urgency' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_urgency as enum ('normal', 'urgent', 'emergency');
  end if;
  -- Who bears the cost. Recorded, not posted.
  if not exists (select 1 from pg_type where typname = 'maintenance_cost_bearer' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_cost_bearer as enum ('owner', 'tenant', 'office');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------
-- unit_id is NOT NULL: a fault happens in a unit, and the unit names its property. A request
-- floating at property level would have no tenant to answer and no scope to be filtered by.
create table if not exists app.maintenance_request (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references app.organization(id) on delete cascade,
  property_id            uuid not null references app.property(id)     on delete cascade,
  unit_id                uuid not null references app.unit(id)         on delete cascade,
  request_no             text,                                   -- MR-YYYY-NNNNN, assigned by trigger
  request_seq            bigint,

  -- Who reported it. A tenant usually; an employee when the office spots it first, and then the
  -- party is null rather than invented.
  reported_by_party_id   uuid references app.party(id) on delete set null,
  reported_by_identity   uuid,                                   -- the signed-in user, tenant or staff

  category               text not null default 'other'
                           check (category in ('plumbing','electrical','hvac','carpentry','appliance','other')),
  urgency                app.maintenance_urgency not null default 'normal',
  status                 app.maintenance_status  not null default 'open',
  description            text not null check (btrim(description) <> ''),

  -- Free text on purpose (see the header). Both may be empty while the request is still unassigned.
  assignee_name          text,
  vendor_name            text,

  estimated_cost_halalas bigint check (estimated_cost_halalas is null or estimated_cost_halalas >= 0),
  actual_cost_halalas    bigint check (actual_cost_halalas    is null or actual_cost_halalas    >= 0),
  cost_bearer            app.maintenance_cost_bearer,

  -- Optional (decision, 14 Aug 2026): a fault reported without a photo beats a fault not reported.
  photo_path             text,                                   -- object key inside the org-assets bucket

  resolved_at            timestamptz,
  resolution_note        text,
  cancelled_reason       text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             uuid,
  deleted_reason         text,

  unique (org_id, request_no)
);

create index if not exists maintenance_org_open_idx
  on app.maintenance_request (org_id, created_at desc)
  where status in ('open', 'in_progress') and deleted_at is null;
create index if not exists maintenance_property_idx on app.maintenance_request (property_id);
create index if not exists maintenance_unit_idx     on app.maintenance_request (unit_id);
create index if not exists maintenance_party_idx    on app.maintenance_request (reported_by_party_id);

-- ---------------------------------------------------------------------------
-- 3. Numbering — MR-YYYY-NNNNN, the same gapless per-(org, year) counter as CT/INV/RV/RM
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_maintenance_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
begin
  if new.request_no is null or btrim(new.request_no) = '' then
    v_year          := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
    new.request_seq := app.next_counter(new.org_id, 'maintenance:' || v_year);
    new.request_no  := 'MR-' || v_year || '-' || lpad(new.request_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_assign_no on app.maintenance_request;
create trigger maintenance_assign_no
  before insert on app.maintenance_request
  for each row execute function app.tg_assign_maintenance_no();

-- resolved_at is stamped by the database, not by the caller: "when did this close" must not depend
-- on a client clock or on an update remembering to set two columns at once.
create or replace function app.tg_maintenance_touch()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  new.updated_at := now();
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif new.status <> 'resolved' then
    new.resolved_at := null;   -- reopened: the closing time is no longer true
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_touch on app.maintenance_request;
create trigger maintenance_touch
  before update on app.maintenance_request
  for each row execute function app.tg_maintenance_touch();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table app.maintenance_request enable row level security;

-- The office: exactly the gate the units use, so a member confined to certain properties sees the
-- requests of those properties and no others — without this file knowing anything about scoping.
drop policy if exists maintenance_office_all on app.maintenance_request;
create policy maintenance_office_all on app.maintenance_request for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- The tenant: reads their own requests through the portal. Read only — every tenant write goes
-- through submit_maintenance_request below.
drop policy if exists maintenance_tenant_select on app.maintenance_request;
create policy maintenance_tenant_select on app.maintenance_request for select
  using (
    exists (
      select 1 from app.party p
      where p.id = maintenance_request.reported_by_party_id
        and p.identity_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. The tenant's one write
-- ---------------------------------------------------------------------------
-- Proves three things before inserting, and says which one failed:
--   * the caller is the party they claim to be,
--   * that party has an ACTIVE contract on the unit today,
--   * they have not already filed more than the daily allowance.
--
-- The rate limit is not about abuse alone: without it the form becomes a channel for the same
-- complaint five times, and the office triage queue stops being readable.
create or replace function app.submit_maintenance_request(
  p_unit        uuid,
  p_category    text,
  p_urgency     text,
  p_description text,
  p_photo_path  text default null
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_party    uuid;
  v_org      uuid;
  v_property uuid;
  v_today    date := (now() at time zone 'Asia/Riyadh')::date;
  v_count    int;
  v_id       uuid;
  v_note     uuid;
begin
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED' using errcode = 'raise_exception';
  end if;

  -- The active contract is the authorization. A former tenant cannot open requests on a unit they
  -- left, and a tenant of unit A cannot open one on unit B.
  select c.org_id, c.property_id, t.party_id
    into v_org, v_property, v_party
  from app.contract c
  join app.tenant   t on t.id = c.tenant_id
  join app.party    p on p.id = t.party_id
  where c.unit_id = p_unit
    and c.status = 'active'
    and c.deleted_at is null
    and p.identity_id = auth.uid()
  limit 1;

  if v_party is null then
    raise exception 'NO_ACTIVE_CONTRACT' using errcode = 'raise_exception';
  end if;

  select count(*) into v_count
  from app.maintenance_request r
  where r.reported_by_party_id = v_party
    and (r.created_at at time zone 'Asia/Riyadh')::date = v_today
    and r.deleted_at is null;

  if v_count >= 5 then
    raise exception 'DAILY_LIMIT' using errcode = 'raise_exception';
  end if;

  insert into app.maintenance_request (
    org_id, property_id, unit_id, reported_by_party_id, reported_by_identity,
    category, urgency, description, photo_path
  )
  values (
    v_org, v_property, p_unit, v_party, auth.uid(),
    coalesce(nullif(btrim(p_category), ''), 'other'),
    coalesce(nullif(btrim(p_urgency), ''), 'normal')::app.maintenance_urgency,
    btrim(p_description),
    nullif(btrim(p_photo_path), '')
  )
  returning id into v_id;

  -- An urgent or emergency fault must reach a person, not a tab. Normal requests do not notify:
  -- a notification for everything is a notification for nothing.
  if (coalesce(nullif(btrim(p_urgency), ''), 'normal'))::app.maintenance_urgency <> 'normal' then
    insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body)
    select v_org, v_property, 'maintenance_urgent', 'maintenance_request', v_id,
           'طلب صيانة عاجل',
           'وحدة ' || u.unit_number || ' — ' || left(btrim(p_description), 140)
    from app.unit u where u.id = p_unit
    on conflict do nothing
    returning id into v_note;

    -- Decision, 14 Aug 2026: yes, email the office. The channel works as of 11 Aug.
    if v_note is not null then
      perform app.enqueue_notification_email(v_note);
    end if;
  end if;

  perform app.write_audit(v_org, 'maintenance.submit', 'maintenance_request', v_id,
                          jsonb_build_object('unit', p_unit, 'urgency', p_urgency));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What the tenant reads back
-- ---------------------------------------------------------------------------
-- The office's internal columns are not in this list: cost, bearer, assignee and vendor are how the
-- office runs the job, not what the tenant is owed. Status and dates are.
create or replace function app.tenant_portal_maintenance(p_tenant uuid)
returns table (
  id uuid, request_no text, category text, urgency app.maintenance_urgency,
  status app.maintenance_status, description text, unit_number text,
  created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select r.id, r.request_no, r.category, r.urgency, r.status, r.description,
           u.unit_number, r.created_at, r.resolved_at
    from app.maintenance_request r
    join app.unit   u on u.id = r.unit_id
    join app.tenant t on t.party_id = r.reported_by_party_id and t.id = p_tenant
    where r.deleted_at is null
    order by r.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants — the 0053 rule: 0001 granted execute to anon/authenticated by default privilege, so a
-- `revoke from public` would close nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.submit_maintenance_request(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app.submit_maintenance_request(uuid, text, text, text, text) to authenticated;

revoke all on function app.tenant_portal_maintenance(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_maintenance(uuid) to authenticated;

-- next_counter is already revoked from public (0022); the trigger runs as definer of its own.
grant select, insert, update on app.maintenance_request to authenticated;

select app.record_migration('0072', 'maintenance');
