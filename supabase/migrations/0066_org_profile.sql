-- 0066_org_profile.sql
-- The organization's own profile: legal identity, national address, collection bank account, logo.
--
-- Why this matters more than it looks: app.issue_invoice (0023) copies org.name / org.vat_number /
-- org.cr_number onto every invoice as the SUPPLIER identity, and four printed documents render them
-- (contract, receipt, owner statement, owner remittance). Until now NOTHING in the product ever
-- wrote those two columns — no screen, no RPC — so every office was printing documents with an
-- empty tax identity. This migration is the storage half of the screen that fills them.
--
-- Every column is ADDITIVE (nullable, no default) — no data loss, no existing query touched. Like
-- org_type, these are PRESENTATION / identity fields: no RLS, trigger, or VAT logic may branch on
-- them (§2 / هـ).

-- ---------------------------------------------------------------------------
-- Legal identity + contact
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists fal_license_no text;  -- رقم ترخيص فال (الهيئة العامة للعقار)
alter table app.organization add column if not exists contact_phone  text;  -- هاتف المكتب كما يُطبع
alter table app.organization add column if not exists contact_email  text;

-- ---------------------------------------------------------------------------
-- Saudi National Address (العنوان الوطني). Kept as its six official parts rather than one free-text
-- line because that is the shape every official document — and a ZATCA standard tax invoice — asks
-- for. A single line cannot be split back apart later.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists address_building_no   text;  -- رقم المبنى (4)
alter table app.organization add column if not exists address_street        text;  -- الشارع
alter table app.organization add column if not exists address_district      text;  -- الحي
alter table app.organization add column if not exists address_city          text;  -- المدينة
alter table app.organization add column if not exists address_postal_code   text;  -- الرمز البريدي (5)
alter table app.organization add column if not exists address_additional_no text;  -- الرقم الإضافي (4)

-- ---------------------------------------------------------------------------
-- Collection bank account — the office's own account, printed on invoices/statements so a tenant
-- knows where to transfer. NOT an owner's account (that lives on app.owner.iban) and never a
-- destination this system pays out to: nothing here initiates a transfer.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists bank_name         text;
alter table app.organization add column if not exists iban              text;
alter table app.organization add column if not exists bank_account_name text;

-- Path inside the private 'org-assets' bucket. Never a URL: the file is streamed through our own
-- origin (/api/org/logo) so the page needs no third-party img-src and the bucket stays private.
alter table app.organization add column if not exists logo_path text;

-- ---------------------------------------------------------------------------
-- Format checks.
--
-- The NEW columns get plain checks — they start out NULL everywhere, so there is nothing to scan.
-- cr_number and vat_number already existed, and this file cannot see what a live database put in
-- them, so those two are added NOT VALID: every INSERT and UPDATE from now on is checked, while a
-- legacy row is left alone. Once the live data is known to be clean:
--   alter table app.organization validate constraint organization_vat_number_chk;
-- ---------------------------------------------------------------------------
do $do$
begin
  -- Saudi VAT number: 15 digits, first and last are 3.
  if not exists (select 1 from pg_constraint where conname = 'organization_vat_number_chk') then
    alter table app.organization add constraint organization_vat_number_chk
      check (vat_number is null or vat_number ~ '^3[0-9]{13}3$') not valid;
  end if;

  -- Commercial registration: 10 digits.
  if not exists (select 1 from pg_constraint where conname = 'organization_cr_number_chk') then
    alter table app.organization add constraint organization_cr_number_chk
      check (cr_number is null or cr_number ~ '^[0-9]{10}$') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_iban_chk') then
    alter table app.organization add constraint organization_iban_chk
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_address_chk') then
    alter table app.organization add constraint organization_address_chk
      check (
            (address_building_no   is null or address_building_no   ~ '^[0-9]{4}$')
        and (address_postal_code   is null or address_postal_code   ~ '^[0-9]{5}$')
        and (address_additional_no is null or address_additional_no ~ '^[0-9]{4}$')
      );
  end if;

  -- فال licence numbers are numeric but their length has changed over the years; only the shape is
  -- asserted, not a length nobody can promise.
  if not exists (select 1 from pg_constraint where conname = 'organization_fal_chk') then
    alter table app.organization add constraint organization_fal_chk
      check (fal_license_no is null or fal_license_no ~ '^[0-9]{4,20}$');
  end if;
end
$do$;

comment on column app.organization.vat_number is
  'الرقم الضريبي — copied onto each invoice as supplier_vat_number at issue time (0023). Changing it does not rewrite issued invoices, by design.';
comment on column app.organization.logo_path is
  'Object path inside the private org-assets bucket. Served through /api/org/logo, never as a public URL.';

-- ---------------------------------------------------------------------------
-- Audit. The organization row is editable by any org admin (policy organization_update, 0012), and
-- three of its columns become the supplier identity on legal documents. A change to them has to be
-- attributable afterwards, so the audit is written by a trigger rather than by the caller: it then
-- covers every path into the table, including ones written after this file.
-- ---------------------------------------------------------------------------
create or replace function app.tg_org_profile_audit() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  changed text[];
begin
  select array_agg(n.key order by n.key) into changed
  from jsonb_each(to_jsonb(new)) as n(key, value)
  where n.value is distinct from (to_jsonb(old) -> n.key)
    and n.key <> 'updated_at';

  if changed is null then
    return new;
  end if;

  -- Field NAMES for everything, but the previous VALUE only for the tax identity. That is the part a
  -- dispute is ever about ("this invoice carries a number we no longer use"), and logging the rest
  -- would copy the office's bank details into a second table for no one's benefit.
  perform app.write_audit(
    new.id, 'org.profile_update', 'organization', new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'fields',     to_jsonb(changed),
      'name_from',  case when new.name      is distinct from old.name      then old.name      end,
      'cr_from',    case when new.cr_number is distinct from old.cr_number then old.cr_number end,
      'vat_from',   case when new.vat_number is distinct from old.vat_number then old.vat_number end
    ))
  );
  return new;
end;
$$;

drop trigger if exists org_profile_audit on app.organization;
create trigger org_profile_audit
  after update on app.organization
  for each row execute function app.tg_org_profile_audit();

-- ---------------------------------------------------------------------------
-- Keep app.identity.email in step with auth.users.
--
-- 0017/0037 provision the profile on INSERT and nothing has watched UPDATE since. A user who changes
-- their e-mail address goes through Supabase Auth (confirmation link, then auth.users.email flips) —
-- and app.identity.email kept the old value forever. Nothing broke loudly, which is why it survived:
-- the stale address is simply where notifications would have gone.
--
-- Only email and phone are synced. full_name is ours to own: it is edited in the app, not in GoTrue.
-- ---------------------------------------------------------------------------
create or replace function app.sync_identity_from_auth() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  update app.identity i
     set email      = coalesce(new.email, i.email),
         phone_e164 = coalesce(v_phone, i.phone_e164),
         phone_raw  = coalesce(new.phone, i.phone_raw),
         updated_at = now()
   where i.id = new.id
     and (new.email is distinct from i.email or v_phone is distinct from i.phone_e164);
  return new;
end;
$$;

do $do$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    execute 'drop trigger if exists on_auth_user_updated on auth.users';
    execute 'create trigger on_auth_user_updated
               after update of email, phone on auth.users
               for each row execute function app.sync_identity_from_auth()';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Logo storage.
--
-- Private bucket, one folder per organization: org-assets/<org_id>/logo.<ext>. The org id in the
-- path is what the policies below prove against, so a member of office A cannot read — let alone
-- overwrite — the logo of office B by guessing a path.
--
-- Supabase-safe / CI-safe: the storage schema only exists on Supabase. On the bare Postgres used by
-- the local test harness this whole block is skipped, exactly like the auth binding in 0017.
-- ---------------------------------------------------------------------------

-- storage.foldername() returns the path segments as text; the first one is only a uuid if we put it
-- there. A cast on a hand-crafted path would raise instead of denying, and a policy that errors is
-- a policy that leaks the fact it errored.
create or replace function app.uuid_or_null(p text) returns uuid
language plpgsql immutable strict as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('org-assets', 'org-assets', false, 524288, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set
    public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists org_assets_read   on storage.objects';
  execute 'drop policy if exists org_assets_write  on storage.objects';
  execute 'drop policy if exists org_assets_update on storage.objects';
  execute 'drop policy if exists org_assets_delete on storage.objects';

  -- Reading is for any member of that org (the logo appears on screens a viewer can open).
  execute $p$
    create policy org_assets_read on storage.objects for select to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_member_of(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  -- Writing is admins only — the logo goes on documents that leave the office.
  execute $p$
    create policy org_assets_write on storage.objects for insert to authenticated
    with check (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  execute $p$
    create policy org_assets_update on storage.objects for update to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  execute $p$
    create policy org_assets_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;
end
$do$;
