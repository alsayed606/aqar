-- 0026_member_invitations.sql
-- Team management helpers on top of the existing membership/invitation model:
--   * org_members()      — an admin-only roster of the active org's members WITH their phone.
--     Identity is self-only under RLS (a member cannot read another member's identity row), so this
--     SECURITY DEFINER function is the single sanctioned way for an admin to see who's on the team.
--   * create_invitation() — an admin mints an invitation; the RAW token is returned ONCE to share as
--     a join link, and only its sha256 hash is stored. accept_invitation() (0013) consumes the token
--     and creates the membership. Revoking/role/status changes stay plain admin-gated table updates.

create or replace function app.org_members()
returns table (
  membership_id uuid,
  identity_id   uuid,
  phone_e164    text,
  role          app.membership_role,
  status        app.membership_status,
  scope_all     boolean,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;
  return query
    select m.id, m.identity_id, i.phone_e164, m.role, m.status, m.scope_all, m.created_at
    from app.membership m
    join app.identity i on i.id = m.identity_id
    where m.org_id = v_org and m.deleted_at is null
    order by (m.role = 'owner') desc, m.created_at;
end;
$$;

create or replace function app.create_invitation(
  p_phone       text,
  p_email       text,
  p_role        app.membership_role,
  p_scope_all   boolean,
  p_expires_days int default 14
)
returns text  -- the raw token, shown once to build the join link
language plpgsql
security invoker
set search_path = app, extensions, pg_temp
as $$
declare
  v_org   uuid := app.current_org_id();
  v_token text;
  v_id    uuid;
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;
  if coalesce(nullif(btrim(p_phone), ''), nullif(btrim(p_email), '')) is null then
    raise exception 'CONTACT_REQUIRED: phone or email' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into app.invitation (org_id, phone_e164, email, role, scope_all, token_hash, expires_at, created_by)
  values (
    v_org,
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''),
    coalesce(p_role, 'staff'),
    coalesce(p_scope_all, true),
    encode(digest(v_token, 'sha256'), 'hex'),
    now() + (coalesce(p_expires_days, 14) || ' days')::interval,
    auth.uid()
  )
  returning id into v_id;

  perform app.write_audit(v_org, 'invitation.create', 'invitation', v_id,
                          jsonb_build_object('role', coalesce(p_role, 'staff')));
  return v_token;
end;
$$;

revoke all on function app.org_members() from public;
revoke all on function app.create_invitation(text, text, app.membership_role, boolean, int) from public;
grant execute on function app.org_members() to authenticated, service_role;
grant execute on function app.create_invitation(text, text, app.membership_role, boolean, int) to authenticated, service_role;
