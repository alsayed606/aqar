-- 0074_identity_linking.sql
-- Who is allowed to become a party — and nothing else. Scope is deliberately narrow: this file
-- closes an open door. The invitation lifecycle (sent / opened / superseded, resend, revoke) is
-- 0075's job and is not touched here.
--
-- WHY NOW: the tenant portal started accepting writes on 14 Aug (0072). Until then a wrong link
-- leaked reads; now it also writes maintenance requests in someone else's name.
--
-- ---------------------------------------------------------------------------
-- 1. Remove app.link_party_identity — an open path to any party in an org
-- ---------------------------------------------------------------------------
-- It was granted to `authenticated` (0013) and accepted a caller-chosen p_party_id, matching ANY
-- live invitation in that org: it never checked the invitation's kind, never checked that the
-- invitation was addressed to that party, and never checked that the party was still unlinked.
-- So any holder of any live token for an org could bind their login to any owner or tenant in it —
-- and could take over a profile that already belonged to somebody else.
--
-- It is dropped rather than repaired: nothing in the product has ever called it (the only caller
-- was one line in the local test suite, updated with this migration), and
-- app.accept_portal_invitation covers its stated purpose under real checks.
drop function if exists app.link_party_identity(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. The identity channel — an operator setting, not a deployment
-- ---------------------------------------------------------------------------
-- Today the product authenticates tenants by email; SMS has no provider yet (ADR-0001). When one
-- is contracted, the switch must be a value change in the platform console, not a release. So the
-- rule that acceptance is matched against lives here as data.
--
--   email  — the signed-in account's email must equal the invitation's email
--   phone  — the account's phone must equal the invitation's phone
--   either — whichever of the two matches is enough
insert into app.platform_setting (key, value, label_ar) values
  ('portal_identity_channel', '"email"'::jsonb, 'قناة إثبات هوية البوابة (بريد / جوال / أيّهما)')
on conflict (key) do nothing;   -- never reset a value the operator has already chosen

create or replace function app.portal_identity_channel()
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce(app.setting('portal_identity_channel', '"email"'::jsonb) #>> '{}', 'email');
$$;

-- Known keys only, and known values for this one. An unvalidated setting is how a typo locks every
-- tenant out of the portal.
--
-- NOTE: whether an SMS provider is actually configured cannot be seen from inside the database —
-- it lives in the deployment's environment. The console is where that check belongs, and it is
-- part of 0075's work; this function only refuses values that are not one of the three.
create or replace function app.operator_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before jsonb;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select value into v_before from app.platform_setting where key = p_key;
  if v_before is null then
    raise exception 'UNKNOWN_SETTING' using errcode = 'raise_exception';
  end if;
  -- Floor of 1, not 0: a zero-day trial provisions an office that is locked out the moment it is
  -- created (0055). Rewriting this function is how that fix nearly got lost.
  if p_key = 'trial_days' and (jsonb_typeof(p_value) <> 'number'
       or (p_value)::text::int < 1 or (p_value)::text::int > 365) then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;
  if p_key = 'default_plan' and not exists (select 1 from app.plan where code = p_value #>> '{}') then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if p_key = 'portal_identity_channel' and coalesce(p_value #>> '{}', '') not in ('email', 'phone', 'either') then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;

  update app.platform_setting
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  perform app.write_audit(null, 'platform.setting_update', 'platform_setting', null,
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptance, under four conditions
-- ---------------------------------------------------------------------------
-- The contact comparison reads the JWT, not app.identity: an email-only sign-up has no identity
-- row at all (app.identity requires a KSA mobile, so the auth.users trigger skips it). The JWT is
-- what the auth provider actually verified about this session, which is precisely the claim we
-- want to test.
--
-- Both portal kinds stay in one function. Owner links run through here too, and narrowing it to
-- tenant_portal would silently break them — the tightening applies to both, which is what the
-- owner portal deserves anyway.
create or replace function app.accept_portal_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_inv     app.invitation;
  v_cur     uuid;
  v_channel text := app.portal_identity_channel();
  -- The claims are read straight from request.jwt.claims rather than through auth.jwt(), which is
  -- the convention this schema already uses (0003, 0069, 0071) and keeps the function testable
  -- outside a Supabase instance.
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_email   text := lower(nullif(btrim(coalesce(v_claims ->> 'email', '')), ''));
  v_phone   text := app.normalize_phone_e164(nullif(btrim(coalesce(v_claims ->> 'phone', '')), ''));
  v_inv_mail text;
  v_ok_mail boolean;
  v_ok_sms  boolean;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  -- (1) a live PORTAL invitation, and (2) one that names a party.
  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  -- (3) the party must still be free. Re-linking is not acceptance — it is a takeover, and undoing
  -- a link is an office action (app.unlink_party_identity below), never a visitor's.
  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null then
    if v_cur = v_me then
      return v_inv.party_id;   -- already mine: idempotent, the second tab is not an error
    end if;
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  -- (4) the account must be the one that was invited.
  v_inv_mail := lower(nullif(btrim(coalesce(v_inv.email, '')), ''));
  v_ok_mail  := v_inv_mail is not null and v_email is not null and v_email = v_inv_mail;
  v_ok_sms   := v_inv.phone_e164 is not null and v_phone is not null and v_phone = v_inv.phone_e164;

  -- A refusal that cannot be acted on is worse than none, so the two causes are named apart: the
  -- invitation carries no address on this channel (the office must fix the record and re-invite),
  -- or it does and this account is not it.
  if v_channel = 'email' and v_inv_mail is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no email address' using errcode = 'raise_exception';
  end if;
  if v_channel = 'phone' and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no phone number' using errcode = 'raise_exception';
  end if;
  if v_channel = 'either' and v_inv_mail is null and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no contact' using errcode = 'raise_exception';
  end if;

  if not (
    (v_channel = 'email'  and v_ok_mail)
    or (v_channel = 'phone'  and v_ok_sms)
    or (v_channel = 'either' and (v_ok_mail or v_ok_sms))
  ) then
    -- Recorded because a mismatch is the signature of a forwarded link, and the office should be
    -- able to see that it happened.
    perform app.write_audit(v_inv.org_id, 'portal.link_refused', 'party', v_inv.party_id,
                            jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
    raise exception 'CONTACT_MISMATCH: sign in with the account this invitation was sent to'
      using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'portal.link', 'party', v_inv.party_id,
                          jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Unlinking — the missing office action
-- ---------------------------------------------------------------------------
-- Without this, a profile linked to the wrong account (or to one its owner has lost) can never be
-- re-invited: acceptance refuses a linked party, and nothing in the product could clear the link.
-- Admins only, and the reason is required — an unlink is how a profile changes hands, and "who did
-- this and why" is the whole value of recording it.
create or replace function app.unlink_party_identity(p_party uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org  uuid;
  v_prev uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  select org_id, identity_id into v_org, v_prev from app.party where id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if v_prev is null then
    return;   -- already unlinked: nothing to undo, and no reason to fail the caller
  end if;

  -- Clearing to NULL is allowed by tg_party_identity_guard, which only gates NULL → value.
  update app.party set identity_id = null where id = p_party;

  perform app.write_audit(v_org, 'portal.unlink', 'party', p_party,
                          jsonb_build_object('previous_identity', v_prev, 'reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants — 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.unlink_party_identity(uuid, text) from public, anon, authenticated;
grant execute on function app.unlink_party_identity(uuid, text) to authenticated;

revoke all on function app.portal_identity_channel() from public, anon;
grant execute on function app.portal_identity_channel() to authenticated, service_role;

-- accept_portal_invitation keeps the grants it already had (authenticated): the gate is inside it.

select app.record_migration('0074', 'identity_linking');
