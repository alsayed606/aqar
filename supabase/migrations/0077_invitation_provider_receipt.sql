-- 0077_invitation_provider_receipt.sql
-- The receipt the provider hands back, kept instead of thrown away.
--
-- 0075 taught the office to read "أُرسلت". It did not teach it what that word means: the application
-- writes it when Resend answers 2xx, which is "accepted for delivery", not "in the tenant's inbox".
-- Those two are usually the same and occasionally are not, and the gap is exactly where a tenant says
-- "لم يصلني شيء" while the screen says it was sent.
--
-- Resend answers with a message id and we were discarding it. Keeping it costs one column and turns
-- that argument into a lookup: paste the id into the provider's log and read delivered / bounced /
-- complained. This migration does not make a message arrive — it makes its absence answerable.
alter table app.invitation
  add column if not exists sent_message_id text;

comment on column app.invitation.sent_message_id is
  'The email provider''s id for the message, as returned when it accepted it. Evidence, not state: it
   says the message was handed over, never that it was read.';

-- ---------------------------------------------------------------------------
-- mark_invitation_sent — now records the receipt too
-- ---------------------------------------------------------------------------
-- The 3-argument form is dropped rather than kept alongside: two overloads separated only by a
-- defaulted trailing argument are ambiguous to call, and PostgREST would have to guess.
drop function if exists app.mark_invitation_sent(uuid, text, text);

create or replace function app.mark_invitation_sent(
  p_invitation uuid,
  p_channel    text,
  p_to         text,
  p_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from app.invitation i where i.id = p_invitation;
  if v_org is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set sent_at         = now(),
         sent_channel    = p_channel,
         sent_to         = nullif(btrim(coalesce(p_to, '')), ''),
         sent_message_id = nullif(btrim(coalesce(p_message_id, '')), '')
   where id = p_invitation;

  -- The id goes into the audit line as well: the invitation row keeps only the latest send, and a
  -- question about a message sent three rotations ago has nowhere else to be answered from.
  perform app.write_audit(v_org, 'portal.invite_sent', 'invitation', p_invitation,
                          jsonb_build_object('channel', p_channel, 'message_id', p_message_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- portal_invitation_state — one more column, so the office never opens a table to find it
-- ---------------------------------------------------------------------------
-- Adding a column to a returns-table demands a drop; create-or-replace cannot change the shape.
drop function if exists app.portal_invitation_state(uuid);

create or replace function app.portal_invitation_state(p_party uuid)
returns table (
  state           text,   -- linked | accepted | pending | sent | opened | revoked | superseded | expired | none
  sent_at         timestamptz,
  sent_channel    text,
  sent_to         text,
  sent_message_id text,
  opened_at       timestamptz,
  expires_at      timestamptz,
  linked          boolean
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
      l.sent_at, l.sent_channel, l.sent_to, l.sent_message_id, l.opened_at, l.expires_at, v_linked
    from (select 1) one left join latest l on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.mark_invitation_sent(uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.portal_invitation_state(uuid)                from public, anon, authenticated;

grant execute on function app.mark_invitation_sent(uuid, text, text, text) to authenticated;
grant execute on function app.portal_invitation_state(uuid)                to authenticated;

select app.record_migration('0077', 'invitation_provider_receipt');
