-- 0057_tenant_identity.sql
-- Sprint M-1: one primary identifier per tenant type, a required establishment representative,
-- and a trade-name (brand) catalogue.
--
-- The rule being encoded (agreed 2 Aug 2026):
--   * individual                    → national id / iqama / passport (exactly one) is REQUIRED
--   * sole_establishment | company  → unified number (700) is REQUIRED, and the person block
--                                     becomes the establishment REPRESENTATIVE (name + id + phone),
--                                     also required.
--   * either case may be waived by recording an explicit id_exempt_reason (government bodies,
--     embassies, foreign companies with no 700 number). An empty field is never a valid answer.
--
-- Design decisions and why:
--   1. entity_type moves onto app.party. It cannot live only on app.tenant: createTenant inserts the
--      party BEFORE the tenant row, so a rule that reads the type at party-insert time has nothing to
--      read, and a CHECK constraint cannot span two tables. tenant.tenant_type/tenant_kind stay as
--      mirrors for backward compatibility and are now maintained by trigger, not by the app layer.
--   2. primary_id is a GENERATED column over the existing identifier columns, so there is no second
--      source of truth and no data migration. Search and de-duplication both read this one column.
--   3. Requirements are enforced by TRIGGER, not by CHECK. A NOT VALID CHECK still fires on UPDATE of
--      a pre-existing row, which would block someone from fixing a phone number on a legacy tenant.
--      The agreed behaviour is: block new incomplete records, keep legacy records editable, and flag
--      them with a "بيانات ناقصة" badge. Only a trigger can compare OLD to NEW and express that.
--   4. Uniqueness is likewise a trigger check rather than a unique index: rows imported before this
--      migration may already collide, and a failing CREATE UNIQUE INDEX would abort the whole apply.
--      Legacy collisions are tolerated; new ones are refused. Promote to a real unique index once
--      a duplicate scan over (org_id, primary_id) comes back empty.

-- ---------------------------------------------------------------------------
-- 1. New columns.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists entity_type text
  check (entity_type in ('individual', 'sole_establishment', 'company'));
alter table app.party add column if not exists passport_no      text;  -- جواز السفر (غير السعوديين)
alter table app.party add column if not exists id_exempt_reason text;  -- سبب الإعفاء من المعرّف
alter table app.party add column if not exists vat_registered   boolean;  -- null = لم يُسأل بعد
alter table app.party add column if not exists rep_name         text;
alter table app.party add column if not exists rep_id_number    text;
alter table app.party add column if not exists rep_capacity     text;
alter table app.party add column if not exists rep_phone_e164   text;
alter table app.party add column if not exists rep_phone_raw    text;

-- At most one personal identifier, so primary_id is never ambiguous.
alter table app.party drop constraint if exists party_one_personal_id;
alter table app.party add constraint party_one_personal_id check (
  num_nonnulls(nullif(national_id, ''), nullif(iqama_id, ''), nullif(passport_no, '')) <= 1
) not valid;

-- New column, so no legacy values can violate it — safe to add as a validated constraint.
alter table app.party drop constraint if exists party_rep_phone_fmt;
alter table app.party add constraint party_rep_phone_fmt
  check (rep_phone_e164 is null or rep_phone_e164 ~ '^\+9665[0-9]{8}$');

-- Existing tenants keep their meaning: tenant.tenant_type was the source until now.
update app.party p
   set entity_type = t.tenant_type
  from app.tenant t
 where t.party_id = p.id and p.entity_type is null;

-- ---------------------------------------------------------------------------
-- 2. The single primary identifier + the completeness flag, both derived.
-- Establishment first: a sole establishment stores its owner's id under rep_id_number, so the 700
-- number is what identifies the *tenant*.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists primary_id text
  generated always as (
    coalesce(nullif(unified_number, ''), nullif(national_id, ''),
             nullif(iqama_id, ''),       nullif(passport_no, ''))
  ) stored;

-- Scoped by role, not by entity_type: a tenant party with no type recorded must still comply,
-- otherwise leaving the type blank would silently opt out of the whole rule.
alter table app.party add column if not exists identity_complete boolean
  generated always as (
    case
      when not ('tenant' = any(roles))                then true
      when coalesce(id_exempt_reason, '') <> ''       then true
      when coalesce(entity_type, 'individual') = 'individual' then
        coalesce(nullif(national_id, ''), nullif(iqama_id, ''), nullif(passport_no, '')) is not null
      else
        nullif(unified_number, '') is not null
        and nullif(rep_name, '')       is not null
        and nullif(rep_id_number, '')  is not null
        and nullif(rep_phone_e164, '') is not null
    end
  ) stored;

create index if not exists party_primary_id_idx on app.party (org_id, primary_id)
  where primary_id is not null and deleted_at is null;
-- Answers "which establishments does this person represent?" without a separate person table.
create index if not exists party_rep_id_idx on app.party (org_id, rep_id_number)
  where rep_id_number is not null and deleted_at is null;
-- Backs the "بيانات ناقصة" filter on the tenants list.
create index if not exists party_incomplete_idx on app.party (org_id)
  where not identity_complete and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Normalisation + format validation (BEFORE).
-- Identifiers are stored digits-only so that search matches whether the user typed spaces or not.
-- ---------------------------------------------------------------------------
create or replace function app.digits_only(p_value text) returns text
language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), '');
$$;

-- The accepted shape of every KSA identifier, in one place. The importer (0058) validates the same
-- values against these patterns, and a format that lives in two files drifts in one of them.
create or replace function app.id_pattern(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'national' then '^1[0-9]{9}$'
    when 'iqama'    then '^2[0-9]{9}$'
    when 'passport' then '^[A-Z0-9]{3,20}$'
    when 'unified'  then '^7[0-9]{9}$'
    when 'cr'       then '^[0-9]{10}$'
    when 'vat'      then '^3[0-9]{13}3$'
    when 'rep'      then '^[12][0-9]{9}$'
  end;
$$;

create or replace function app.assert_id_format(p_code text, p_value text, p_pattern text)
returns void language plpgsql immutable as $$
begin
  if p_value is not null and p_value !~ p_pattern then
    raise exception '%: %', p_code, p_value using errcode = 'check_violation';
  end if;
end;
$$;

-- Only values that are new or actually changed are validated, so a legacy row carrying a malformed
-- identifier can still have its phone or name corrected.
create or replace function app.assert_party_id_formats(p_new app.party, p_old app.party)
returns void language plpgsql as $$
declare fresh boolean := p_old.id is null;
begin
  if fresh or p_new.national_id is distinct from p_old.national_id then
    perform app.assert_id_format('INVALID_NATIONAL_ID', p_new.national_id, app.id_pattern('national'));
  end if;
  if fresh or p_new.iqama_id is distinct from p_old.iqama_id then
    perform app.assert_id_format('INVALID_IQAMA_ID', p_new.iqama_id, app.id_pattern('iqama'));
  end if;
  if fresh or p_new.passport_no is distinct from p_old.passport_no then
    perform app.assert_id_format('INVALID_PASSPORT', p_new.passport_no, app.id_pattern('passport'));
  end if;
  if fresh or p_new.unified_number is distinct from p_old.unified_number then
    perform app.assert_id_format('INVALID_UNIFIED_NUMBER', p_new.unified_number, app.id_pattern('unified'));
  end if;
  if fresh or p_new.cr_number is distinct from p_old.cr_number then
    perform app.assert_id_format('INVALID_CR_NUMBER', p_new.cr_number, app.id_pattern('cr'));
  end if;
  if fresh or p_new.vat_number is distinct from p_old.vat_number then
    perform app.assert_id_format('INVALID_VAT_NUMBER', p_new.vat_number, app.id_pattern('vat'));
  end if;
  if fresh or p_new.rep_id_number is distinct from p_old.rep_id_number then
    perform app.assert_id_format('INVALID_REP_ID', p_new.rep_id_number, app.id_pattern('rep'));
  end if;
end;
$$;

create or replace function app.tg_party_identity_normalize() returns trigger
language plpgsql as $$
begin
  new.national_id    := app.digits_only(new.national_id);
  new.iqama_id       := app.digits_only(new.iqama_id);
  new.unified_number := app.digits_only(new.unified_number);
  new.cr_number      := app.digits_only(new.cr_number);
  new.vat_number     := app.digits_only(new.vat_number);
  new.rep_id_number  := app.digits_only(new.rep_id_number);
  new.passport_no    := nullif(upper(regexp_replace(coalesce(new.passport_no, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.rep_phone_raw  := nullif(trim(coalesce(new.rep_phone_raw, '')), '');
  new.id_exempt_reason := nullif(trim(coalesce(new.id_exempt_reason, '')), '');
  -- Derive only when a raw phone was supplied, so clearing the field actually clears it.
  if new.rep_phone_raw is not null then
    new.rep_phone_e164 := app.normalize_phone_e164(new.rep_phone_raw);
  end if;

  -- OLD is NULL on INSERT, which assert_party_id_formats reads as "validate everything".
  perform app.assert_party_id_formats(new, old);
  return new;
end;
$$;

drop trigger if exists party_identity_normalize on app.party;
create trigger party_identity_normalize before insert or update on app.party
  for each row execute function app.tg_party_identity_normalize();

-- ---------------------------------------------------------------------------
-- 4. Uniqueness + the completeness rule (AFTER — generated columns are only populated by then).
-- ---------------------------------------------------------------------------
create or replace function app.tg_party_identity_rules() returns trigger
language plpgsql as $$
declare v_dup uuid;
begin
  if new.primary_id is not null and new.deleted_at is null then
    select id into v_dup from app.party
     where org_id = new.org_id and primary_id = new.primary_id
       and id <> new.id and deleted_at is null
     limit 1;
    if v_dup is not null then
      raise exception 'DUPLICATE_IDENTIFIER: % is already used by party %', new.primary_id, v_dup
        using errcode = 'unique_violation';
    end if;
  end if;

  -- New records must be complete. Existing incomplete records stay editable (they carry the
  -- "بيانات ناقصة" badge), but a record that was complete may not be emptied back out.
  if not new.identity_complete and (tg_op = 'INSERT' or old.identity_complete) then
    raise exception 'IDENTITY_INCOMPLETE: tenant % is missing its primary identifier', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- NOT "party_identity_guard" — 0013 already owns that name for the Party↔Identity no-auto-link
-- guard, and reusing it would drop a security trigger.
drop trigger if exists party_identity_rules on app.party;
create trigger party_identity_rules after insert or update on app.party
  for each row execute function app.tg_party_identity_rules();

-- ---------------------------------------------------------------------------
-- 5. tenant.tenant_type / tenant_kind become maintained mirrors of party.entity_type.
-- Removes the three-parallel-columns drift (legal_kind / tenant_kind / tenant_type) without
-- dropping anything that existing reads depend on.
-- ---------------------------------------------------------------------------
create or replace function app.tg_tenant_type_sync() returns trigger
language plpgsql as $$
declare v_type text;
begin
  select coalesce(entity_type, 'individual') into v_type from app.party where id = new.party_id;
  new.tenant_type := coalesce(v_type, 'individual');
  new.tenant_kind := (case when new.tenant_type = 'company' then 'company' else 'individual' end)::app.legal_kind;
  return new;
end;
$$;

drop trigger if exists tenant_type_sync on app.tenant;
create trigger tenant_type_sync before insert or update on app.tenant
  for each row execute function app.tg_tenant_type_sync();

create or replace function app.tg_party_type_propagate() returns trigger
language plpgsql as $$
begin
  update app.tenant
     set tenant_type = coalesce(new.entity_type, 'individual'),
         tenant_kind = (case when new.entity_type = 'company' then 'company' else 'individual' end)::app.legal_kind
   where party_id = new.id;
  return null;
end;
$$;

drop trigger if exists party_type_propagate on app.party;
create trigger party_type_propagate after update of entity_type on app.party
  for each row when (old.entity_type is distinct from new.entity_type)
  execute function app.tg_party_type_propagate();

-- ---------------------------------------------------------------------------
-- 6. Trade-name catalogue. One commercial registration runs several brand names, each under its own
-- municipal licence. The contract keeps its frozen trade_name TEXT (it is a legal document and must
-- record the name as signed); trade_name_id only records which catalogue entry it came from.
-- ---------------------------------------------------------------------------
create table if not exists app.trade_name (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references app.organization(id) on delete cascade,
  party_id             uuid not null references app.party(id) on delete cascade,
  name                 text not null,
  municipal_license_no text,          -- رقم رخصة البلدية
  license_expiry       date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  deleted_by           uuid,
  deleted_reason       text
);

create unique index if not exists trade_name_uniq on app.trade_name (org_id, party_id, name)
  where deleted_at is null;
create index if not exists trade_name_party_idx on app.trade_name (party_id) where deleted_at is null;

drop trigger if exists trade_name_set_updated_at on app.trade_name;
create trigger trade_name_set_updated_at before update on app.trade_name
  for each row execute function app.set_updated_at();

alter table app.trade_name enable row level security;
drop policy if exists trade_name_all on app.trade_name;
create policy trade_name_all on app.trade_name for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- 0001's default privileges cover functions only, so tables need an explicit grant. No DELETE:
-- brands are retired with deleted_at like every other record here.
grant select, insert, update on app.trade_name to authenticated;

-- Outside the tg_contract_immutable frozen set (0013), so it stays correctable after activation.
alter table app.contract add column if not exists trade_name_id uuid references app.trade_name(id);
create index if not exists contract_trade_name_idx on app.contract (trade_name_id)
  where trade_name_id is not null;
