-- 0061_pdpl_export_erasure.sql
-- Launch sprint: the PDPL rights this product has to be able to honour —
-- access/portability (export) and erasure (delete) — for both kinds of data subject.
--
-- There are TWO subjects here and they are not the same person:
--   * the OFFICE, our customer. We are the controller for their account, so their deletion request
--     is ours to execute.
--   * the TENANT or OWNER whose personal data the office holds. There the OFFICE is the controller
--     and we are the processor, so we do not act on a tenant's request — we give the office the
--     tool to act on it. Hence export_party_data / erase_party alongside the org-level pair.
--
-- What erasure cannot touch, and why. PDPL does not override a statutory retention duty: a tax
-- invoice snapshots buyer_name / buyer_id / buyer_vat_number (0023) precisely because ZATCA requires
-- it, and a settled charge is an accounting record. So erase_party redacts the OPERATIONAL record
-- and leaves the FINANCIAL one intact. Promising more than that in the UI would be a lie, and
-- quietly deleting invoices would expose the office to a compliance failure it never chose.

-- ---------------------------------------------------------------------------
-- 1. Marking an erased party, and teaching 0057's completeness flag about it.
-- Without this, erase_party would trip the 0057 guard: nulling the identifiers turns a complete
-- record incomplete, and that transition is exactly what the guard refuses.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists erased_at     timestamptz;
alter table app.party add column if not exists erased_reason text;

drop index if exists app.party_incomplete_idx;
alter table app.party drop column if exists identity_complete;
alter table app.party add column identity_complete boolean
  generated always as (
    case
      -- An erased record is complete by definition: there is nothing left that ought to be filled.
      when erased_at is not null                      then true
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

create index if not exists party_incomplete_idx on app.party (org_id)
  where not identity_complete and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Export — the access / portability right.
-- Admin-gated: a viewer may read a tenant on screen, but bulk extraction of an office's entire
-- record set is a different act and belongs to whoever is accountable for the account.
-- ---------------------------------------------------------------------------
create or replace function app.export_org_data(p_org uuid) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_out jsonb;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'organization', (select to_jsonb(o) from app.organization o where o.id = p_org),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'role', m.role, 'status', m.status, 'full_name', i.full_name,
                  'email', i.email, 'phone', i.phone_e164, 'joined_at', m.created_at)), '[]'::jsonb)
                from app.membership m join app.identity i on i.id = m.identity_id
                where m.org_id = p_org and m.deleted_at is null),
    'parties',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.party t     where t.org_id = p_org and t.deleted_at is null),
    'properties', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.property t  where t.org_id = p_org and t.deleted_at is null),
    'buildings',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.building t  where t.org_id = p_org and t.deleted_at is null),
    'units',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.unit t      where t.org_id = p_org and t.deleted_at is null),
    'contracts',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.contract t  where t.org_id = p_org and t.deleted_at is null),
    'charges',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.charge t    where t.org_id = p_org and t.deleted_at is null),
    'payments',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.payment t   where t.org_id = p_org and t.deleted_at is null),
    'invoices',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.invoice t   where t.org_id = p_org)
  ) into v_out;

  perform app.write_audit(p_org, 'pdpl.export_org', 'organization', p_org, jsonb_build_object('scope', 'full'));
  return v_out;
end;
$$;

-- What an office hands a tenant or owner who exercises their right of access. Scoped to one subject:
-- exporting the whole org to answer one person's request would disclose everybody else's data.
create or replace function app.export_party_data(p_org uuid, p_party uuid) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_out jsonb;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'subject',   (select to_jsonb(t) from app.party t where t.id = p_party),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                  from app.contract c join app.tenant tn on tn.id = c.tenant_id
                  where c.org_id = p_org and tn.party_id = p_party),
    'payments',  (select coalesce(jsonb_agg(to_jsonb(pm)), '[]'::jsonb)
                  from app.payment pm where pm.org_id = p_org and pm.party_id = p_party),
    'invoices',  (select coalesce(jsonb_agg(to_jsonb(iv)), '[]'::jsonb)
                  from app.invoice iv where iv.org_id = p_org and iv.buyer_party_id = p_party),
    'trade_names', (select coalesce(jsonb_agg(to_jsonb(tnm)), '[]'::jsonb)
                  from app.trade_name tnm where tnm.party_id = p_party and tnm.deleted_at is null)
  ) into v_out;

  perform app.write_audit(p_org, 'pdpl.export_party', 'party', p_party, '{}'::jsonb);
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Erasure of one data subject, executed by the office.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party(p_org uuid, p_party uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_active int;
  v_invoices int;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- A live tenancy is a contract in force. Erasing the counterparty to a running lease is not a
  -- privacy request the office can grant; end the contract first.
  select count(*) into v_active
    from app.contract c join app.tenant t on t.id = c.tenant_id
   where c.org_id = p_org and t.party_id = p_party and c.status = 'active' and c.deleted_at is null;
  if v_active > 0 then
    raise exception 'ERASE_ACTIVE_CONTRACT: % active contract(s) reference this party', v_active
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_invoices from app.invoice where org_id = p_org and buyer_party_id = p_party;

  update app.party
     set display_name   = 'بيانات محذوفة',
         national_id    = null, iqama_id = null, passport_no = null,
         cr_number      = null, vat_number = null, unified_number = null, cr_expiry = null,
         phone_e164     = null, phone_raw = null, email = null,
         rep_name       = null, rep_id_number = null, rep_capacity = null,
         rep_phone_e164 = null, rep_phone_raw = null,
         id_exempt_reason = null,
         -- Unlink the portal login so the erased record can never be signed into again.
         identity_id    = null,
         erased_at      = now(),
         erased_reason  = p_reason
   where id = p_party;

  -- The signing representative recorded on each contract is personal data too. These columns sit
  -- outside tg_contract_immutable's frozen set (0042), so an activated contract keeps its legal
  -- and financial terms while the person's details go.
  update app.contract c
     set representative_name = null, representative_capacity = null,
         representative_id   = null, representative_phone = null
    from app.tenant t
   where t.id = c.tenant_id and t.party_id = p_party and c.org_id = p_org;

  update app.trade_name set deleted_at = now(), deleted_reason = 'pdpl_erasure'
   where party_id = p_party and deleted_at is null;

  perform app.write_audit(p_org, 'pdpl.erase_party', 'party', p_party,
                          jsonb_build_object('reason', p_reason, 'invoices_retained', v_invoices));

  -- Reported, not hidden: the office has to be able to tell the data subject what was kept and why.
  return jsonb_build_object('erased', true, 'invoices_retained', v_invoices);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Office account deletion, with a grace period.
-- Deliberately NOT immediate. An accidental click here destroys a business's records, and 30 days
-- of reversibility costs nothing next to that.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists deletion_requested_at timestamptz;
alter table app.organization add column if not exists deletion_requested_by uuid;
alter table app.organization add column if not exists deletion_reason       text;
alter table app.organization add column if not exists purge_after           timestamptz;

-- What survives a purge, and why: these are OUR sales records, not the customer's data. Saudi tax
-- law obliges us as the seller to keep them, and every organization foreign key cascades — so
-- deleting the org row would take our own accounts with it.
create table if not exists app.retained_billing (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,          -- intentionally NOT a foreign key: the org is gone
  org_name           text,
  cr_number          text,
  vat_number         text,
  plan_code          text,
  amount_halalas     bigint,
  status             text,
  gateway_payment_id text,
  paid_at            timestamptz,
  purged_at          timestamptz not null default now()
);
alter table app.retained_billing enable row level security;

create or replace function app.request_org_deletion(p_org uuid, p_reason text default null)
returns timestamptz
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_after timestamptz := now() + interval '30 days';
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.organization
     set deletion_requested_at = now(), deletion_requested_by = auth.uid(),
         deletion_reason = p_reason, purge_after = v_after
   where id = p_org and deleted_at is null;

  perform app.write_audit(p_org, 'pdpl.request_deletion', 'organization', p_org,
                          jsonb_build_object('purge_after', v_after, 'reason', p_reason));
  return v_after;
end;
$$;

create or replace function app.cancel_org_deletion(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.organization
     set deletion_requested_at = null, deletion_requested_by = null,
         deletion_reason = null, purge_after = null
   where id = p_org;
  perform app.write_audit(p_org, 'pdpl.cancel_deletion', 'organization', p_org, '{}'::jsonb);
end;
$$;

-- The purge itself. Deleting the organization row is what does the work: every org-scoped table
-- already declares `on delete cascade`, so the database removes them all in the right order. That
-- is the point — a hand-maintained list of DELETE statements would silently miss the next table
-- somebody adds, and leave personal data behind under a promise that it was gone.
-- The escape hatch the purge needs, and the reason it is not an escape hatch for anybody else.
--
-- set_config() is callable by any client, so a GUC alone would let a signed-in user switch these
-- guards off — and `authenticated` holds UPDATE on app.membership, which is enough to downgrade the
-- last owner and leave an office with nobody in charge. The role test is what closes that: inside a
-- SECURITY DEFINER function current_user is the definer, while a direct statement from the browser
-- runs as `authenticated`. So the flag only means anything where it was set on purpose.
create or replace function app.org_purge_in_progress() returns boolean
language sql stable set search_path = app, pg_temp as $$
  select coalesce(current_setting('app.allow_org_purge', true), '') = 'on'
     and current_user not in ('authenticated', 'anon');
$$;

-- The last-owner guard (0013) fires when the cascade removes the final owner membership. That guard
-- exists to stop an office locking itself out of its own account — a purpose that does not survive
-- the office being deleted on its own instruction.
create or replace function app.tg_protect_last_owner() returns trigger
language plpgsql as $$
declare
  remaining int;
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old.role = 'owner' and old.status = 'active' and old.deleted_at is null then
    if tg_op = 'DELETE'
       or new.role <> 'owner'
       or new.status <> 'active'
       or new.deleted_at is not null then
      select count(*) into remaining
      from app.membership m
      where m.org_id = old.org_id
        and m.role = 'owner'
        and m.status = 'active'
        and m.deleted_at is null
        and m.id <> old.id;
      if remaining = 0 then
        raise exception 'LAST_OWNER_PROTECTED: cannot remove or downgrade the last active owner of org %', old.org_id
          using errcode = 'raise_exception';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- The two append-only guards have to yield to the purge for the same reason. They protect history
-- from being rewritten inside a live account; they were never meant to make an account undeletable,
-- and a purge that half-completes is worse than either outcome. Both keep refusing everything else.
create or replace function app.tg_audit_immutable() returns trigger
language plpgsql as $$
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create or replace function app.tg_subscription_event_immutable() returns trigger
language plpgsql as $$
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'SUBSCRIPTION_EVENT_APPEND_ONLY: subscription_event rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create or replace function app.purge_due_org_deletions()
returns table (purged int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record;
  v_count int := 0;
begin
  -- Transaction-local: it lapses at commit, so it cannot leak into a later statement.
  perform set_config('app.allow_org_purge', 'on', true);

  for r in
    select id, name, cr_number, vat_number from app.organization
     where purge_after is not null and purge_after <= now()
  loop
    insert into app.retained_billing (org_id, org_name, cr_number, vat_number, plan_code,
                                      amount_halalas, status, gateway_payment_id, paid_at)
    select r.id, r.name, r.cr_number, r.vat_number, sp.plan_code,
           sp.amount_halalas, sp.status::text, sp.gateway_payment_id, sp.paid_at
      from app.subscription_payment sp
     where sp.org_id = r.id and sp.status = 'paid';

    delete from app.organization where id = r.id;
    v_count := v_count + 1;
  end loop;

  perform set_config('app.allow_org_purge', 'off', true);
  return query select v_count;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default. The purge must never be
-- reachable by a customer — it is irreversible and it runs across offices.
revoke all on function app.purge_due_org_deletions() from public, anon, authenticated;
grant execute on function app.purge_due_org_deletions() to service_role;

revoke all on function app.export_org_data(uuid)          from public;
revoke all on function app.export_party_data(uuid, uuid)  from public;
revoke all on function app.erase_party(uuid, uuid, text)  from public;
revoke all on function app.request_org_deletion(uuid, text) from public;
revoke all on function app.cancel_org_deletion(uuid)      from public;
-- These five carry their own is_org_admin gate, so authenticated access is correct and intended.
grant execute on function app.export_org_data(uuid)           to authenticated, service_role;
grant execute on function app.export_party_data(uuid, uuid)   to authenticated, service_role;
grant execute on function app.erase_party(uuid, uuid, text)   to authenticated, service_role;
grant execute on function app.request_org_deletion(uuid, text) to authenticated, service_role;
grant execute on function app.cancel_org_deletion(uuid)       to authenticated, service_role;
