-- 0075_invitation_lifecycle.sql
-- The portal invitation stops being a token and becomes a thing with a state.
--
-- Before this file the office could create an invitation and then knew nothing: not whether it was
-- sent, not whether it was opened, not whether it still pointed at an address the tenant still uses.
-- The only two facts recorded were "accepted" and "revoked", and both were written by someone else.
--
--   pending ──► sent ──► opened ──► accepted
--      │         │         │
--      └─────────┴─────────┴──► expired  (by date)
--                │
--                ├──► revoked     (the office withdrew it)
--                └──► superseded  (the tenant's email or phone changed)
--
-- 0074 decided WHO may accept. This decides WHAT the office can see and do about it. Sending the
-- message itself is the application's job — this file only records that it happened.

-- ---------------------------------------------------------------------------
-- 1. The state a token carries
-- ---------------------------------------------------------------------------
alter table app.invitation
  add column if not exists sent_at         timestamptz,
  add column if not exists sent_channel    text check (sent_channel is null or sent_channel in ('email', 'sms')),
  -- The address it actually went to, kept apart from invitation.email: the office record may be
  -- edited afterwards, and "where did we send it" must not change when it is.
  add column if not exists sent_to         text,
  add column if not exists opened_at       timestamptz,
  add column if not exists superseded_at   timestamptz,
  add column if not exists superseded_reason text;

-- ---------------------------------------------------------------------------
-- 1b. Retire the duplicates that already exist
-- ---------------------------------------------------------------------------
-- Before this migration nothing stopped a second "رابط البوابة" click from minting another live
-- token, and production has profiles carrying several. The invariant below cannot be declared over
-- data that already breaks it, and the honest repair is the one the new rule implies: the newest
-- token stands, the older ones are retired as superseded.
--
-- Retiring rather than deleting, and superseded rather than revoked: nobody withdrew these — they
-- were replaced. And a token that reaches the office's inbox later should read as "replaced by a
-- newer link", which is what actually happened.
with ranked as (
  select id,
         row_number() over (partition by party_id, kind order by created_at desc, id desc) as rn
  from app.invitation
  where party_id is not null
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null
    and revoked_at is null
    and superseded_at is null
)
update app.invitation i
   set superseded_at = now(),
       superseded_reason = 'replaced_by_newer_invite'
  from ranked r
 where i.id = r.id and r.rn > 1;

-- One live portal invitation per party and kind. Two live tokens double the attack surface for a
-- convenience nobody asked for — resending rotates rather than accumulates.
create unique index if not exists invitation_one_live_portal
  on app.invitation (party_id, kind)
  where party_id is not null
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null
    and revoked_at is null
    and superseded_at is null;

-- ---------------------------------------------------------------------------
-- 2. Changing the contact retires the invitation
-- ---------------------------------------------------------------------------
-- An invitation is addressed to one mailbox or one number. If the office corrects the tenant's email
-- after sending it, the old address still holds a live token — and that address may now belong to
-- somebody else entirely, or may have been the typo that prompted the correction.
--
-- Only PENDING portal invitations are touched. An accepted one is history, and history is not edited.
create or replace function app.tg_party_contact_supersedes_invites()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  if new.email is distinct from old.email or new.phone_e164 is distinct from old.phone_e164 then
    update app.invitation
       set superseded_at = now(),
           superseded_reason = 'contact_changed'
     where party_id = new.id
       and kind in ('owner_portal', 'tenant_portal')
       and accepted_at is null
       and revoked_at is null
       and superseded_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists party_contact_supersedes_invites on app.party;
create trigger party_contact_supersedes_invites
  after update on app.party
  for each row execute function app.tg_party_contact_supersedes_invites();

-- Acceptance must refuse a superseded token too. 0074 already checks accepted/revoked/expired; this
-- adds the fourth retirement reason without touching anything else in that function.
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

  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and superseded_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null then
    if v_cur = v_me then
      return v_inv.party_id;
    end if;
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  v_inv_mail := lower(nullif(btrim(coalesce(v_inv.email, '')), ''));
  v_ok_mail  := v_inv_mail is not null and v_email is not null and v_email = v_inv_mail;
  v_ok_sms   := v_inv.phone_e164 is not null and v_phone is not null and v_phone = v_inv.phone_e164;

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
-- 3. Sent / opened — the two facts the office was missing
-- ---------------------------------------------------------------------------
-- Called by the application right after the message leaves. Deliberately not "mark as sent, hope for
-- the best": the address is stored as it was used, so a later edit of the tenant record cannot
-- rewrite where the message actually went.
create or replace function app.mark_invitation_sent(p_invitation uuid, p_channel text, p_to text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  if coalesce(p_channel, '') not in ('email', 'sms') then
    raise exception 'INVALID_CHANNEL' using errcode = 'raise_exception';
  end if;
  select org_id into v_org from app.invitation where id = p_invitation;
  if v_org is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set sent_at = now(), sent_channel = p_channel, sent_to = nullif(btrim(coalesce(p_to, '')), '')
   where id = p_invitation;

  perform app.write_audit(v_org, 'portal.invite_sent', 'invitation', p_invitation,
                          jsonb_build_object('channel', p_channel));
end;
$$;

-- Stamped when the join page is opened with a live token. First open only: the office wants to know
-- "did it arrive", not how many times the page was refreshed.
--
-- It returns nothing on purpose. A visitor holding a token learns whether it is live from trying to
-- accept it, and this function must not become a way to probe tokens for information.
create or replace function app.mark_invitation_opened(p_token text)
returns void
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
begin
  update app.invitation
     set opened_at = coalesce(opened_at, now())
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null and expires_at > now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Resend and revoke
-- ---------------------------------------------------------------------------
-- Resending rotates: the live token is retired and a new one issued. Two live tokens for one profile
-- is a wider door for no gain, and "which link did I send you?" is a support call nobody needs.
create or replace function app.resend_portal_invitation(p_party uuid)
returns text
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
declare
  v_org   uuid;
  v_kind  text;
  v_phone text;
  v_email text;
  v_token text;
  v_id    uuid;
begin
  select p.org_id, p.phone_e164, p.email into v_org, v_phone, v_email
  from app.party p where p.id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'NO_CONTACT: add a phone or email to the record first' using errcode = 'raise_exception';
  end if;
  if exists (select 1 from app.party where id = p_party and identity_id is not null) then
    raise exception 'ALREADY_LINKED: unlink the profile before inviting again' using errcode = 'raise_exception';
  end if;

  -- The kind follows what the party already is, so a resend cannot quietly turn an owner invitation
  -- into a tenant one.
  select case when exists (select 1 from app.tenant t where t.party_id = p_party and t.deleted_at is null)
              then 'tenant_portal' else 'owner_portal' end into v_kind;

  update app.invitation
     set revoked_at = now(), revoked_by = auth.uid()
   where party_id = p_party
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, p_party, v_kind, v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'portal.invite_resend', 'party', p_party,
                          jsonb_build_object('invitation', v_id, 'kind', v_kind));
  return v_token;
end;
$$;

create or replace function app.revoke_portal_invitation(p_party uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
  v_n   int;
begin
  select org_id into v_org from app.party where id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set revoked_at = now(), revoked_by = auth.uid()
   where party_id = p_party
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform app.write_audit(v_org, 'portal.invite_revoke', 'party', p_party,
                            jsonb_build_object('count', v_n, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. What the office sees
-- ---------------------------------------------------------------------------
-- One row per party: the state of its portal access, in the order the office reads it.
--
-- The token is never returned — not its hash either. This answers "where does this stand", and the
-- link itself is shown once, at the moment it is created.
create or replace function app.portal_invitation_state(p_party uuid)
returns table (
  state       text,     -- linked | accepted | pending | sent | opened | revoked | superseded | expired | none
  sent_at     timestamptz,
  sent_channel text,
  sent_to     text,
  opened_at   timestamptz,
  expires_at  timestamptz,
  linked      boolean
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_org    uuid;
  v_linked boolean;
begin
  select p.org_id, p.identity_id is not null into v_org, v_linked from app.party p where p.id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.has_org_access(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  return query
    with latest as (
      select i.* from app.invitation i
      where i.party_id = p_party and i.kind in ('owner_portal', 'tenant_portal')
      order by i.created_at desc
      limit 1
    )
    select
      case
        -- The link is the fact that matters; how it was obtained is history.
        when v_linked                       then 'linked'
        when l.id is null                   then 'none'
        when l.accepted_at   is not null    then 'accepted'
        when l.revoked_at    is not null    then 'revoked'
        when l.superseded_at is not null    then 'superseded'
        when l.expires_at    <= now()       then 'expired'
        when l.opened_at     is not null    then 'opened'
        when l.sent_at       is not null    then 'sent'
        else 'pending'
      end,
      l.sent_at, l.sent_channel, l.sent_to, l.opened_at, l.expires_at, v_linked
    from (select 1) one left join latest l on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — 0053 rule: revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.mark_invitation_sent(uuid, text, text)   from public, anon, authenticated;
revoke all on function app.mark_invitation_opened(text)             from public, anon, authenticated;
revoke all on function app.resend_portal_invitation(uuid)           from public, anon, authenticated;
revoke all on function app.revoke_portal_invitation(uuid, text)     from public, anon, authenticated;
revoke all on function app.portal_invitation_state(uuid)            from public, anon, authenticated;

grant execute on function app.mark_invitation_sent(uuid, text, text)   to authenticated;
grant execute on function app.mark_invitation_opened(text)             to authenticated;
grant execute on function app.resend_portal_invitation(uuid)           to authenticated;
grant execute on function app.revoke_portal_invitation(uuid, text)     to authenticated;
grant execute on function app.portal_invitation_state(uuid)            to authenticated;

select app.record_migration('0075', 'invitation_lifecycle');
