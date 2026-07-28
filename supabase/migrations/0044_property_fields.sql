-- 0044_property_fields.sql
-- Sprint L (Mogod alignment, Tier A): richer property fields + one-org-per-user. All property columns
-- are ADDITIVE (nullable / defaulted) — no data loss, existing rows/queries untouched. The new fields
-- are PRESENTATION only (like org_type): no RLS/trigger/VAT logic may branch on them (§2 / هـ).

alter table app.property add column if not exists holding_type text not null default 'owned'
  check (holding_type in ('owned', 'managed', 'investment'));   -- مملوك / إدارة أملاك / استثمار
alter table app.property add column if not exists property_code    text;
alter table app.property add column if not exists property_type    text;                 -- برج/مجمّع/مستودع… (عرضي)
alter table app.property add column if not exists occupancy_type   text
  check (occupancy_type is null or occupancy_type in ('family', 'bachelor'));            -- عوائل / عزاب
alter table app.property add column if not exists deed_type        text;
alter table app.property add column if not exists deed_date        date;
alter table app.property add column if not exists water_meter      text;
alter table app.property add column if not exists electricity_meter text;
alter table app.property add column if not exists planned_residential_units int;
alter table app.property add column if not exists planned_commercial_units  int;

-- Backfill holding_type from reality: a property whose owner is NOT the org's self-owner is managed.
update app.property p set holding_type = 'managed'
 where holding_type = 'owned'
   and exists (select 1 from app.owner o where o.id = p.owner_id and o.is_self = false);

-- ---------------------------------------------------------------------------
-- One organization per user: a person may CREATE only one org (they can still be invited into others).
-- Replaces the 0036 definition; the only change is the OWN_ORG_EXISTS guard. Backward compatible —
-- existing multi-org owners keep everything; only a new create call for an already-owner is blocked.
-- ---------------------------------------------------------------------------
create or replace function app.create_organization(
  p_name text, p_org_type app.org_type default 'management_office'
) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid;
  v_party uuid;
  v_me    uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  if exists (
    select 1 from app.membership m
    where m.identity_id = v_me and m.role = 'owner' and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'OWN_ORG_EXISTS: a user can create only one organization' using errcode = 'raise_exception';
  end if;

  insert into app.organization (name, org_type) values (p_name, p_org_type) returning id into v_org;

  insert into app.org_subscription (org_id, plan_code, status, trial_ends_at)
  values (v_org, 'basic', 'trialing', now() + interval '30 days');

  insert into app.membership (identity_id, org_id, role, status, scope_all)
  values (v_me, v_org, 'owner', 'active', true);

  insert into app.party (org_id, display_name, legal_kind, roles)
  values (v_org, p_name, 'company', array['owner']::app.party_role[])
  returning id into v_party;

  insert into app.owner (org_id, party_id, is_self, owner_kind)
  values (v_org, v_party, true, 'company');

  perform app.write_audit(v_org, 'org.create', 'organization', v_org,
                          jsonb_build_object('name', p_name, 'org_type', p_org_type));
  return v_org;
end;
$$;
