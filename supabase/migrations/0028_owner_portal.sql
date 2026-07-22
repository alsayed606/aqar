-- 0028_owner_portal.sql
-- Owner self-service portal. An owner is NOT an office member (no membership → the office RLS gives
-- them nothing). Instead their party is linked to a login identity, and they read ONLY their own data
-- through SECURITY DEFINER functions gated on party.identity_id = auth.uid(). The office RLS model is
-- left completely untouched.
--
-- Linking reuses the existing invitation table + the Party↔Identity link guard (app.allow_party_link):
--   * create_owner_invitation(owner) — an admin mints a portal invite for a specific owner's party.
--   * accept_owner_invitation(token) — the owner (after signing in) links their party to their login.
-- Reading:
--   * my_owner_links()             — the owner profiles linked to me (across offices).
--   * owner_portal_statement/…     — gate on ownership, then reuse the office-side aggregation (which,
--     invoked inside a definer function, runs above RLS for that one owner).

alter table app.invitation add column if not exists party_id uuid references app.party(id);
alter table app.invitation add column if not exists kind     text not null default 'membership';  -- membership | owner_portal

-- ---------------------------------------------------------------------------
-- Ownership gate: does this owner belong to the caller's login?
-- ---------------------------------------------------------------------------
create or replace function app.owner_is_mine(p_owner uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.owner o join app.party p on p.id = o.party_id
    where o.id = p_owner and o.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- create_owner_invitation(owner) → raw token (shown once). Admin-gated.
-- ---------------------------------------------------------------------------
create or replace function app.create_owner_invitation(p_owner uuid)
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

  select o.party_id, p.phone_e164, p.email into v_party, v_phone, v_email
  from app.owner o join app.party p on p.id = o.party_id
  where o.id = p_owner and o.org_id = v_org and o.deleted_at is null and not o.is_self;
  if v_party is null then
    raise exception 'OWNER_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'OWNER_NO_CONTACT: add a phone or email to the owner first' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, v_party, 'owner_portal', v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'owner_portal.invite', 'party', v_party, jsonb_build_object('invitation', v_id));
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_owner_invitation(token) → linked party id. Links the party to the caller's login.
-- SECURITY DEFINER: sets app.allow_party_link for its single UPDATE (mirrors link_party_identity).
-- ---------------------------------------------------------------------------
create or replace function app.accept_owner_invitation(p_token text)
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
    and kind = 'owner_portal' and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null and v_cur <> v_me then
    raise exception 'ALREADY_LINKED: this owner is already linked to another login' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'owner_portal.link', 'party', v_inv.party_id, '{}'::jsonb);
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal reads. All SECURITY DEFINER, all gated on ownership by login identity.
-- ---------------------------------------------------------------------------
create or replace function app.my_owner_links()
returns table (owner_id uuid, org_id uuid, org_name text, display_name text, iban text, bank_name text)
language sql stable security definer set search_path = app, pg_temp as $$
  select o.id, o.org_id, org.name, p.display_name, o.iban, o.bank_name
  from app.owner o
  join app.party p on p.id = o.party_id
  join app.organization org on org.id = o.org_id
  where p.identity_id = auth.uid() and o.deleted_at is null and not o.is_self
  order by org.name;
$$;

create or replace function app.owner_portal_statement(p_owner uuid, p_from date, p_to date)
returns table (property_id uuid, property_name text, collected_halalas bigint,
               outstanding_halalas bigint, fee_halalas bigint, net_halalas bigint)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  -- owner_statement is SECURITY INVOKER; invoked here it runs above RLS (definer context) for this owner.
  return query select * from app.owner_statement(p_owner, p_from, p_to);
end;
$$;

create or replace function app.owner_portal_properties(p_owner uuid)
returns table (id uuid, name text, city text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pr.id, pr.name, pr.city from app.property pr
    where pr.owner_id = p_owner and pr.deleted_at is null order by pr.name;
end;
$$;

create or replace function app.owner_portal_remittances(p_owner uuid)
returns table (id uuid, remittance_no text, amount_halalas bigint, method app.payment_method,
               remitted_at timestamptz, period_from date, period_to date, reference text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select r.id, r.remittance_no, r.amount_halalas, r.method, r.remitted_at, r.period_from, r.period_to, r.reference
    from app.owner_remittance r
    where r.owner_id = p_owner and r.deleted_at is null order by r.remitted_at desc;
end;
$$;

revoke all on function app.create_owner_invitation(uuid) from public;
revoke all on function app.accept_owner_invitation(text) from public;
grant execute on function app.owner_is_mine(uuid),
                         app.create_owner_invitation(uuid),
                         app.accept_owner_invitation(text),
                         app.my_owner_links(),
                         app.owner_portal_statement(uuid, date, date),
                         app.owner_portal_properties(uuid),
                         app.owner_portal_remittances(uuid)
  to authenticated, service_role;
