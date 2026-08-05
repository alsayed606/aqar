-- 0068_migration_ledger.sql
-- A record of which migrations this database actually has.
--
-- Sixty-seven migrations were applied by hand, and the only record of which ones landed was a list
-- in CHANGELOG.md maintained from memory. That list said 0029 was applied. It was not — and nothing
-- noticed for months, because the dashboard call that would have failed loudly (`my_tenant_links`)
-- has its error discarded, so a missing migration looked exactly like a tenant with no portal.
--
-- From here on, every migration records itself in its last line. Nobody has to remember.

create table if not exists app.schema_migration (
  version     text primary key,                       -- '0068'
  name        text not null,                          -- '0068_migration_ledger'
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  -- true for 0001–0067: we inferred these from the objects they left behind, so applied_at is the
  -- moment we looked, not the moment they ran. The distinction matters when reading this table as
  -- history rather than as an inventory.
  backfilled  boolean not null default false,
  -- false where a migration only REPLACES function bodies and leaves no new object to probe for.
  -- Recorded honestly rather than dressed up: "we could not check this one" is information.
  verified    boolean not null default true
);

comment on table app.schema_migration is
  'Which migrations this database has. Written by app.record_migration() from the last line of each migration file.';

alter table app.schema_migration enable row level security;
-- No policy on purpose: nothing reads this through PostgREST. Which migrations are missing is a map
-- of which guards are missing, so it is read only through the operator-gated function below.
revoke all on app.schema_migration from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_migration — the one line every future migration ends with.
-- ---------------------------------------------------------------------------
create or replace function app.record_migration(p_version text, p_name text)
returns void
language sql
set search_path = app, pg_temp as $$
  insert into app.schema_migration (version, name)
  values (p_version, p_name)
  on conflict (version) do update set name = excluded.name, applied_at = now(), applied_by = current_user;
$$;

-- 0053 rule: 0001 grants execute on every app function to anon and authenticated by default, so
-- `revoke from public` closes nothing. This one writes to the ledger and has no internal check —
-- it must be revoked by name or any signed-in user could forge a migration record.
revoke all on function app.record_migration(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- migration_status — what the database has. Operators only.
-- ---------------------------------------------------------------------------
create or replace function app.migration_status()
returns table (version text, name text, applied_at timestamptz, backfilled boolean, verified boolean)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN: platform operators only' using errcode = 'raise_exception';
  end if;
  return query
    select m.version, m.name, m.applied_at, m.backfilled, m.verified
    from app.schema_migration m
    order by m.version;
end;
$$;

revoke all on function app.migration_status() from public, anon;
grant execute on function app.migration_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Probe helpers. Existence is checked BY NAME, not by signature: `to_regprocedure` needs the exact
-- argument list, and a probe that fails because someone added a default parameter would report a
-- migration missing when it is present — the one thing this table must never do.
-- ---------------------------------------------------------------------------
create or replace function app.has_app_function(p_name text) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = p_name
  );
$$;

create or replace function app.has_app_column(p_table text, p_column text) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = p_table and column_name = p_column
  );
$$;

-- ---------------------------------------------------------------------------
-- Backfill 0001–0067 by looking at the schema, not by trusting a list.
--
-- Each row carries a boolean SQL expression that is true when that migration's work is present. A
-- migration whose probe fails is NOT recorded — it shows up as missing, which is the entire point.
-- Four rows carry a null probe: they only replace function bodies and leave nothing new behind, so
-- no probe can distinguish "applied" from "not applied". Those are recorded unverified.
-- ---------------------------------------------------------------------------
do $backfill$
declare
  r        record;
  v_ok     boolean;
  v_probed int := 0;
  v_found  int := 0;
  v_assumed int := 0;
begin
  for r in
    select * from (values
      ('0001', '0001_extensions_roles',        $p$to_regnamespace('app') is not null and exists (select 1 from pg_extension where extname = 'pgcrypto')$p$),
      ('0002', '0002_enums',                   $p$to_regtype('app.org_type') is not null$p$),
      ('0003', '0003_utils',                   $p$app.has_app_function('fold_digits')$p$),
      ('0004', '0004_identity_auth',           $p$to_regclass('app.identity') is not null$p$),
      ('0005', '0005_org_membership',          $p$to_regclass('app.organization') is not null$p$),
      ('0006', '0006_party_property',          $p$to_regclass('app.party') is not null$p$),
      ('0007', '0007_contracts_agreements',    $p$to_regclass('app.contract') is not null$p$),
      ('0008', '0008_charges_payments',        $p$to_regclass('app.charge') is not null$p$),
      ('0009', '0009_documents_audit',         $p$to_regclass('app.audit_log') is not null$p$),
      ('0010', '0010_import_staging',          $p$to_regclass('app.import_batch') is not null$p$),
      ('0011', '0011_access_functions',        $p$app.has_app_function('has_org_access')$p$),
      ('0012', '0012_rls_policies',            $p$exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'organization' and policyname = 'organization_select')$p$),
      ('0013', '0013_triggers_guards',         $p$app.has_app_function('write_audit')$p$),
      -- 0014 built the phone-OTP tables and functions; 0032 dropped every one of them. Nothing it
      -- created still exists to probe for, and its absence is indistinguishable from success.
      ('0014', '0014_auth_otp',                null),
      ('0015', '0015_financial_views',         $p$to_regclass('app.charge_balance') is not null$p$),
      ('0016', '0016_import_functions',        $p$app.has_app_function('import_commit')$p$),
      ('0017', '0017_identity_auth_users',     $p$app.has_app_function('handle_new_auth_user')$p$),
      ('0018', '0018_org_visibility',          $p$app.has_app_function('is_member_of')$p$),
      ('0019', '0019_contract_ops',            $p$app.has_app_function('activate_contract')$p$),
      ('0020', '0020_owner_statement',         $p$app.has_app_function('owner_statement')$p$),
      ('0021', '0021_dashboard_kpis',          $p$app.has_app_function('dashboard_finance')$p$),
      ('0022', '0022_receipt_vouchers',        $p$to_regclass('app.org_counter') is not null$p$),
      ('0023', '0023_tax_invoice',             $p$to_regclass('app.invoice') is not null$p$),
      ('0024', '0024_credit_debit_notes',      $p$app.has_app_function('issue_credit_note')$p$),
      ('0025', '0025_owner_remittance',        $p$to_regclass('app.owner_remittance') is not null$p$),
      ('0026', '0026_member_invitations',      $p$app.has_app_function('org_members')$p$),
      ('0027', '0027_contract_amendments',     $p$app.has_app_function('contract_period_shape')$p$),
      ('0028', '0028_owner_portal',            $p$app.has_app_function('owner_is_mine')$p$),
      ('0029', '0029_tenant_portal',           $p$app.has_app_function('tenant_is_mine')$p$),
      ('0030', '0030_portal_documents',        $p$app.has_app_function('tenant_portal_receipt')$p$),
      ('0031', '0031_contract_renewal',        $p$app.has_app_function('renew_contract')$p$),
      -- 0032 is a demolition: it is applied when the things it removed are gone.
      ('0032', '0032_drop_legacy_otp',         $p$not app.has_app_function('otp_pepper') and to_regclass('app.otp_challenge') is null$p$),
      ('0033', '0033_viewer_readonly',         $p$app.has_app_function('is_org_writer')$p$),
      ('0034', '0034_notifications',           $p$to_regclass('app.notification') is not null$p$),
      ('0035', '0035_search_indexes',          $p$to_regclass('app.property_name_trgm') is not null$p$),
      ('0036', '0036_subscription',            $p$to_regclass('app.plan') is not null$p$),
      -- 0037 replaces 0017's function, so the function alone proves nothing. Its constraint does.
      ('0037', '0037_identity_email',          $p$exists (select 1 from pg_constraint where conname = 'identity_contact_present')$p$),
      ('0038', '0038_notification_delivery',   $p$to_regclass('app.notification_delivery') is not null$p$),
      ('0039', '0039_subscription_payments',   $p$to_regclass('app.subscription_payment') is not null$p$),
      ('0040', '0040_recurring_billing',       $p$to_regclass('app.org_payment_method') is not null$p$),
      ('0041', '0041_roles_matrix',            $p$to_regclass('app.role_capability') is not null$p$),
      ('0042', '0042_tenant_establishment',    $p$app.has_app_column('party', 'vat_number')$p$),
      ('0043', '0043_payment_method_ejar',     $p$exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'payment_method' and e.enumlabel = 'ejar')$p$),
      -- 0044 also replaces create_organization; the column is the part only it adds.
      ('0044', '0044_property_fields',         $p$app.has_app_column('property', 'holding_type')$p$),
      ('0045', '0045_contract_numbering_ejar', $p$app.has_app_function('tg_assign_contract_no')$p$),
      -- 0046 only re-emits normalize_amount_halalas and normalize_date, both of which 0003 already
      -- created. Nothing new exists to look for.
      ('0046', '0046_import_parse_hardening',  null),
      ('0047', '0047_import_validate_hardening', $p$app.has_app_function('normalize_decimal')$p$),
      ('0048', '0048_platform_foundation',     $p$to_regclass('app.subscription_event') is not null$p$),
      ('0049', '0049_platform_kpis',           $p$app.has_app_function('platform_kpis')$p$),
      ('0050', '0050_platform_tenant_360',     $p$app.has_app_function('platform_identity_activity')$p$),
      ('0051', '0051_platform_billing',        $p$app.has_app_function('operator_upsert_plan')$p$),
      ('0052', '0052_platform_health_audit',   $p$to_regclass('app.cron_run') is not null$p$),
      -- 0053 took privileges away. It is applied when they are gone.
      ('0053', '0053_service_role_only_grants', $p$to_regprocedure('app.subscription_active(uuid)') is not null and not has_function_privilege('authenticated', 'app.subscription_active(uuid)', 'execute')$p$),
      ('0054', '0054_platform_settings_flags_broadcast', $p$to_regclass('app.platform_setting') is not null$p$),
      -- 0055 and 0056 only re-emit functions 0054 and 0052 had already created.
      ('0055', '0055_platform_fixes',          null),
      ('0056', '0056_alerts_limit_scan',       null),
      ('0057', '0057_tenant_identity',         $p$to_regclass('app.trade_name') is not null$p$),
      ('0058', '0058_import_tenant_identity',  $p$app.has_app_function('map_entity_type')$p$),
      ('0059', '0059_notification_sweep',      $p$app.has_app_function('generate_notifications_for')$p$),
      ('0060', '0060_rate_limit',              $p$to_regclass('app.rate_limit') is not null$p$),
      ('0061', '0061_pdpl_export_erasure',     $p$app.has_app_function('erase_party')$p$),
      ('0062', '0062_offline_subscription_payment', $p$app.has_app_function('subscription_bank_details')$p$),
      ('0063', '0063_utilities',               $p$to_regclass('app.utility_meter') is not null$p$),
      ('0064', '0064_utility_reports',         $p$to_regclass('app.utility_monthly_consumption') is not null$p$),
      ('0065', '0065_entity_notes',            $p$to_regclass('app.entity_note') is not null$p$),
      ('0066', '0066_org_profile',             $p$app.has_app_function('tg_org_profile_audit')$p$),
      ('0067', '0067_archive_guards',          $p$app.has_app_function('archive_cascade_in_progress')$p$)
    ) as t(version, name, probe)
  loop
    if r.probe is null then
      insert into app.schema_migration (version, name, backfilled, verified)
      values (r.version, r.name, true, false)
      on conflict (version) do nothing;
      v_assumed := v_assumed + 1;
      continue;
    end if;

    -- The expression is a literal from the list above; nothing here comes from a caller.
    execute 'select ' || r.probe into v_ok;
    v_probed := v_probed + 1;

    if v_ok then
      insert into app.schema_migration (version, name, backfilled, verified)
      values (r.version, r.name, true, true)
      on conflict (version) do nothing;
      v_found := v_found + 1;
    else
      raise notice 'MIGRATION MISSING: % (%) — its objects are not in this database', r.version, r.name;
    end if;
  end loop;

  raise notice 'Ledger backfill: % of % probed migrations found, % recorded unverified.',
    v_found, v_probed, v_assumed;
end
$backfill$;

select app.record_migration('0068', '0068_migration_ledger');
