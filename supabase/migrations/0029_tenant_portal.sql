-- 0029_tenant_portal.sql
-- Tenant self-service portal — the mirror of the owner portal (0028). A tenant is a party (not an
-- office member); their party is linked to a login and they read ONLY their own data through
-- SECURITY DEFINER functions gated on party.identity_id = auth.uid(). Office RLS is untouched.
--
-- Reuses invitation.party_id + kind ('tenant_portal') from 0028, and generalizes acceptance:
-- accept_portal_invitation handles both owner_portal and tenant_portal invites (both just link the
-- party). create_owner_invitation / accept_owner_invitation from 0028 stay valid.

create or replace function app.tenant_is_mine(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.tenant t join app.party p on p.id = t.party_id
    where t.id = p_tenant and t.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

create or replace function app.create_tenant_invitation(p_tenant uuid)
returns text
language plpgsql security invoker set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid := app.current_org_id();
  v_party uuid;
  v_phone text;
  v_email text;
  v_token text;
  v_id    uuid;
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;

  select t.party_id, p.phone_e164, p.email into v_party, v_phone, v_email
  from app.tenant t join app.party p on p.id = t.party_id
  where t.id = p_tenant and t.org_id = v_org and t.deleted_at is null;
  if v_party is null then raise exception 'TENANT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if v_phone is null and v_email is null then
    raise exception 'TENANT_NO_CONTACT: add a phone or email to the tenant first' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, v_party, 'tenant_portal', v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'tenant_portal.invite', 'party', v_party, jsonb_build_object('invitation', v_id));
  return v_token;
end;
$$;

-- Generic portal-invite accept: links the invitation's party to the caller's login (owner or tenant).
create or replace function app.accept_portal_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_me  uuid := auth.uid();
  v_inv app.invitation;
  v_cur uuid;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception'; end if;

  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null and v_cur <> v_me then
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'portal.link', 'party', v_inv.party_id,
                          jsonb_build_object('kind', v_inv.kind));
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal reads (SECURITY DEFINER, gated on tenant ownership by login identity).
-- ---------------------------------------------------------------------------
create or replace function app.my_tenant_links()
returns table (tenant_id uuid, org_id uuid, org_name text, display_name text)
language sql stable security definer set search_path = app, pg_temp as $$
  select t.id, t.org_id, org.name, p.display_name
  from app.tenant t
  join app.party p on p.id = t.party_id
  join app.organization org on org.id = t.org_id
  where p.identity_id = auth.uid() and t.deleted_at is null
  order by org.name;
$$;

create or replace function app.tenant_portal_contracts(p_tenant uuid)
returns table (id uuid, contract_number text, status app.contract_status, start_date date, end_date date,
               annual_rent_halalas bigint, payment_frequency app.payment_frequency,
               unit_number text, property_name text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select c.id, c.contract_number, c.status, c.start_date, c.end_date, c.annual_rent_halalas,
           c.payment_frequency, u.unit_number, pr.name
    from app.contract c join app.unit u on u.id = c.unit_id join app.property pr on pr.id = c.property_id
    where c.tenant_id = p_tenant and c.deleted_at is null order by c.start_date desc;
end;
$$;

create or replace function app.tenant_portal_charges(p_tenant uuid)
returns table (charge_id uuid, contract_id uuid, due_date date, gross_halalas bigint,
               allocated_halalas bigint, balance_halalas bigint, is_settled boolean, is_overdue boolean)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select cb.charge_id, cb.contract_id, cb.due_date, cb.gross_halalas::bigint,
           cb.allocated_halalas::bigint, cb.balance_halalas::bigint, cb.is_settled, cb.is_overdue
    from app.charge_balance cb
    where cb.contract_id in (select c.id from app.contract c where c.tenant_id = p_tenant and c.deleted_at is null)
    order by cb.due_date;
end;
$$;

create or replace function app.tenant_portal_payments(p_tenant uuid)
returns table (id uuid, receipt_no text, amount_halalas bigint, method app.payment_method, received_at timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pay.id, pay.receipt_no, pay.amount_halalas, pay.method, pay.received_at
    from app.payment pay
    where pay.party_id = (select tt.party_id from app.tenant tt where tt.id = p_tenant) and pay.deleted_at is null
    order by pay.received_at desc;
end;
$$;

revoke all on function app.create_tenant_invitation(uuid) from public;
revoke all on function app.accept_portal_invitation(text) from public;
grant execute on function app.tenant_is_mine(uuid),
                         app.create_tenant_invitation(uuid),
                         app.accept_portal_invitation(text),
                         app.my_tenant_links(),
                         app.tenant_portal_contracts(uuid),
                         app.tenant_portal_charges(uuid),
                         app.tenant_portal_payments(uuid)
  to authenticated, service_role;
