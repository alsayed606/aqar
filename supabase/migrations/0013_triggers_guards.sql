-- 0013_triggers_guards.sql
-- Behavioural guarantees: updated_at, contract immutability, last-owner protection, the
-- Party↔Identity no-auto-link guard, unit-status history, allocation invariants, append-only audit,
-- and the SECURITY DEFINER RPCs (org creation, invitation accept, explicit party link, org switch).

-- ---------------------------------------------------------------------------
-- updated_at maintenance on every mutable table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'identity','auth_method','organization','feature_flag','membership','party','owner','tenant',
    'property','building','unit','contract','management_agreement','charge','payment','document'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on app.%I
         for each row execute function app.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Contract immutability after activation. §7 rule 5.
-- Once status = 'active', the legal/financial fields are frozen; only lifecycle transitions
-- (status, termination, soft-delete) may change. Everything else must go through an amendment.
-- ---------------------------------------------------------------------------
create or replace function app.tg_contract_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'active' then
    if row(
         new.property_id, new.unit_id, new.tenant_id, new.contract_number, new.ejar_contract_number,
         new.deed_number, new.contract_kind, new.start_date, new.end_date, new.start_date_hijri,
         new.end_date_hijri, new.annual_rent_halalas, new.payment_frequency, new.deposit_halalas,
         new.service_fees_halalas, new.terms
       ) is distinct from row(
         old.property_id, old.unit_id, old.tenant_id, old.contract_number, old.ejar_contract_number,
         old.deed_number, old.contract_kind, old.start_date, old.end_date, old.start_date_hijri,
         old.end_date_hijri, old.annual_rent_halalas, old.payment_frequency, old.deposit_halalas,
         old.service_fees_halalas, old.terms
       )
    then
      raise exception 'CONTRACT_IMMUTABLE: active contract % cannot be edited; create a contract_amendment', old.id
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end;
$$;

create trigger contract_immutable before update on app.contract
  for each row execute function app.tg_contract_immutable();

-- ---------------------------------------------------------------------------
-- Last-owner protection. §5. Cannot delete/downgrade/suspend the last active org owner.
-- ---------------------------------------------------------------------------
create or replace function app.tg_protect_last_owner() returns trigger
language plpgsql as $$
declare
  remaining int;
begin
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
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger protect_last_owner before update or delete on app.membership
  for each row execute function app.tg_protect_last_owner();

-- ---------------------------------------------------------------------------
-- Party↔Identity no-auto-link guard. §5, §10 test 10.
-- identity_id may transition from NULL to a value ONLY while the session flag app.allow_party_link
-- is 'on', which is set exclusively inside the SECURITY DEFINER accept/link RPCs below. A phone
-- match alone can never link — there is simply no code path that does it.
-- ---------------------------------------------------------------------------
create or replace function app.tg_party_identity_guard() returns trigger
language plpgsql as $$
begin
  if new.identity_id is not null
     and (tg_op = 'INSERT' or old.identity_id is distinct from new.identity_id) then
    if coalesce(current_setting('app.allow_party_link', true), '') <> 'on' then
      raise exception 'PARTY_LINK_FORBIDDEN: Party.identity_id can only be set via a valid invitation accept'
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end;
$$;

create trigger party_identity_guard before insert or update on app.party
  for each row execute function app.tg_party_identity_guard();

-- ---------------------------------------------------------------------------
-- Unit status ↔ history sync. §7 rule 10. Keeps exactly one open segment per unit.
-- ---------------------------------------------------------------------------
create or replace function app.tg_unit_status_sync() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into app.unit_status_history (org_id, unit_id, status, from_ts, changed_by)
    values (new.org_id, new.id, new.current_status, now(), auth.uid());
  elsif tg_op = 'UPDATE' and new.current_status is distinct from old.current_status then
    update app.unit_status_history set to_ts = now()
    where unit_id = new.id and to_ts is null;
    insert into app.unit_status_history (org_id, unit_id, status, from_ts, changed_by)
    values (new.org_id, new.id, new.current_status, now(), auth.uid());
  end if;
  return null;
end;
$$;

create trigger unit_status_sync after insert or update of current_status on app.unit
  for each row execute function app.tg_unit_status_sync();

-- ---------------------------------------------------------------------------
-- Allocation invariants. §7 rule 1, §10 test 12.
-- No allocation may push a payment over its amount or a charge over its gross due; org must match.
-- Partial / late / overpayment / one-payment-two-charges all fall out of these two ceilings.
-- ---------------------------------------------------------------------------
create or replace function app.tg_allocation_check() returns trigger
language plpgsql as $$
declare
  pay_amount bigint; p_org uuid;
  chg_gross  bigint; c_org uuid;
  pay_used   bigint; chg_used bigint;
begin
  select amount_halalas, org_id into pay_amount, p_org from app.payment where id = new.payment_id;
  select amount_incl_vat_halalas, org_id into chg_gross, c_org from app.charge where id = new.charge_id;

  if p_org is null or c_org is null then
    raise exception 'ALLOCATION_BAD_REF' using errcode = 'raise_exception';
  end if;
  if new.org_id <> p_org or new.org_id <> c_org then
    raise exception 'ALLOCATION_ORG_MISMATCH: allocation org must equal payment and charge org'
      using errcode = 'raise_exception';
  end if;

  select coalesce(sum(amount_halalas), 0) into pay_used
  from app.payment_allocation where payment_id = new.payment_id and id <> new.id;
  select coalesce(sum(amount_halalas), 0) into chg_used
  from app.payment_allocation where charge_id = new.charge_id and id <> new.id;

  if pay_used + new.amount_halalas > pay_amount then
    raise exception 'ALLOCATION_EXCEEDS_PAYMENT: payment % over-allocated', new.payment_id
      using errcode = 'raise_exception';
  end if;
  if chg_used + new.amount_halalas > chg_gross then
    raise exception 'ALLOCATION_EXCEEDS_CHARGE: charge % over-allocated', new.charge_id
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

create trigger allocation_check before insert or update on app.payment_allocation
  for each row execute function app.tg_allocation_check();

-- ---------------------------------------------------------------------------
-- Audit log append-only. §8. No UPDATE, no DELETE — ever.
-- ---------------------------------------------------------------------------
create or replace function app.tg_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create trigger audit_immutable before update or delete on app.audit_log
  for each row execute function app.tg_audit_immutable();

-- ---------------------------------------------------------------------------
-- write_audit — helper that stamps the three identifiers. §8.
-- ---------------------------------------------------------------------------
create or replace function app.write_audit(
  p_org uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  insert into app.audit_log (org_id, identity_id, membership_id, action, entity_type, entity_id, detail)
  values (
    p_org,
    auth.uid(),
    case when p_org is null then null else app.current_membership_id() end,
    p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_organization — the only way an org is born. Creates the org, the creator's owner
-- membership, and the auto self-Owner (is_self = true) with its Party. §2.
-- SECURITY DEFINER: runs above RLS; sets allow_party_link only for the rows it creates.
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

  insert into app.organization (name, org_type) values (p_name, p_org_type) returning id into v_org;

  insert into app.membership (identity_id, org_id, role, status, scope_all)
  values (v_me, v_org, 'owner', 'active', true);

  -- Self-owner: the org owning itself. It is a party with NO identity link (an entity, not a person).
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

-- ---------------------------------------------------------------------------
-- accept_invitation — accept by TOKEN (never by phone). Creates the membership on accept. §5.
-- ---------------------------------------------------------------------------
create or replace function app.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_inv    app.invitation;
  v_me     uuid := auth.uid();
  v_mid    uuid;
  v_prop   uuid;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  select * into v_inv
  from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if v_inv.id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used'
      using errcode = 'raise_exception';
  end if;

  insert into app.membership (identity_id, org_id, role, status, scope_all, invited_by)
  values (v_me, v_inv.org_id, v_inv.role, 'active', v_inv.scope_all, v_inv.created_by)
  on conflict (identity_id, org_id)
  do update set status = 'active', role = excluded.role, scope_all = excluded.scope_all
  returning id into v_mid;

  if not v_inv.scope_all then
    foreach v_prop in array v_inv.scope_property_ids loop
      insert into app.membership_property_scope (membership_id, property_id)
      values (v_mid, v_prop) on conflict do nothing;
    end loop;
  end if;

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'invitation.accept', 'membership', v_mid,
                          jsonb_build_object('invitation_id', v_inv.id));
  return v_mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- link_party_identity — the ONLY sanctioned way to attach an Identity to a Party, and only with a
-- valid invitation token addressed to that party's org. Sets allow_party_link for this statement. §5.
-- ---------------------------------------------------------------------------
create or replace function app.link_party_identity(p_party_id uuid, p_token text) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid;
  v_inv   app.invitation;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  select org_id into v_org from app.party where id = p_party_id;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select * into v_inv
  from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and org_id = v_org
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if v_inv.id is null then
    raise exception 'INVITATION_INVALID' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);   -- transaction-local
  update app.party set identity_id = v_me where id = p_party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_org, 'party.link_identity', 'party', p_party_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- switch_active_org — records the org-switch event (the switch itself is header-driven). §8.
-- ---------------------------------------------------------------------------
create or replace function app.switch_active_org(p_org uuid) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  if not exists (
    select 1 from app.membership m
    where m.identity_id = auth.uid() and m.org_id = p_org
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'NOT_A_MEMBER' using errcode = 'raise_exception';
  end if;
  insert into app.audit_log (org_id, identity_id, membership_id, action)
  values (p_org, auth.uid(),
          (select id from app.membership where identity_id = auth.uid() and org_id = p_org limit 1),
          'auth.org_switch');
end;
$$;

revoke all on function app.create_organization(text, app.org_type) from public;
revoke all on function app.accept_invitation(text)                 from public;
revoke all on function app.link_party_identity(uuid, text)         from public;
revoke all on function app.switch_active_org(uuid)                 from public;
revoke all on function app.write_audit(uuid, text, text, uuid, jsonb) from public;
grant execute on function app.create_organization(text, app.org_type) to authenticated, service_role;
grant execute on function app.accept_invitation(text)                 to authenticated, service_role;
grant execute on function app.link_party_identity(uuid, text)         to authenticated, service_role;
grant execute on function app.switch_active_org(uuid)                 to authenticated, service_role;
grant execute on function app.write_audit(uuid, text, text, uuid, jsonb) to authenticated, service_role;
