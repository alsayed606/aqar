-- 0038_notification_delivery.sql
-- Sprint F: multi-channel notification DELIVERY (email first, per ADR-0002). This is ADDITIVE over
-- 0034's `notification` table — that content is channel-agnostic — adding an append-only outbox plus
-- the functions to ENQUEUE (one email per active org member who has an email) and to DRAIN (claim →
-- send → mark) with full idempotency and a bounded 3-attempt backoff (1 → 5 → 30 min).
--
-- Trust boundary: enqueue runs with the user's session (has_org_access-gated). claim/mark are the
-- ONLY functions the Vercel-Cron drainer calls, and are granted to service_role ONLY. SMS is a future
-- channel value, not built here.

do $$ begin
  if not exists (select 1 from pg_type where typname='notification_channel' and typnamespace='app'::regnamespace) then
    create type app.notification_channel as enum ('in_app','email','sms');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname='delivery_status' and typnamespace='app'::regnamespace) then
    create type app.delivery_status as enum ('pending','sent','failed');
  end if;
end $$;

-- The outbox. org_id is denormalized from the notification for a simple RLS predicate and cheap
-- per-org queries. One row per (notification, channel, recipient) — the uniqueness that makes
-- enqueue idempotent and prevents a double-send.
create table if not exists app.notification_delivery (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references app.organization(id) on delete cascade,
  notification_id      uuid not null references app.notification(id)  on delete cascade,
  channel              app.notification_channel not null,
  target               text not null,                       -- resolved recipient (email address for now)
  status               app.delivery_status not null default 'pending',
  attempts             int  not null default 0,
  max_attempts         int  not null default 3,
  next_attempt_at      timestamptz not null default now(),  -- eligibility gate (backoff/lease)
  provider             text,                                -- 'resend'
  provider_message_id  text,
  provider_response    jsonb,
  last_error           text,
  last_attempt_at      timestamptz,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);

create unique index if not exists notification_delivery_unique
  on app.notification_delivery (notification_id, channel, target);
create index if not exists notification_delivery_due
  on app.notification_delivery (channel, next_attempt_at) where status = 'pending';

alter table app.notification_delivery enable row level security;
grant select on app.notification_delivery to authenticated;
-- Read-only to members of the owning org; every write goes through the DEFINER functions below.
drop policy if exists notification_delivery_select on app.notification_delivery;
create policy notification_delivery_select on app.notification_delivery for select
  using (app.has_org_access(org_id));

-- ---------------------------------------------------------------------------
-- enqueue_email_deliveries(org) — called by the app (user session) right after generate_notifications.
-- One pending email row per unread notification × active member who has an email. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_email_deliveries(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drainer surface (service_role ONLY). claim leases eligible rows atomically (SKIP LOCKED) so two
-- overlapping cron runs never grab the same row — the core of the no-double-send guarantee. It also
-- pushes next_attempt_at forward by the per-attempt backoff, so a crashed send is retried, not stuck.
-- Backoff by the attempt just taken: 1st → 1 min, 2nd → 5 min, 3rd → 30 min. max_attempts caps it.
-- ---------------------------------------------------------------------------
create or replace function app.claim_email_deliveries(p_max int default 25)
returns setof app.notification_delivery
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  return query
  update app.notification_delivery d
     set attempts        = d.attempts + 1,
         last_attempt_at  = now(),
         next_attempt_at  = now() + (case d.attempts + 1
                                       when 1 then interval '1 minute'
                                       when 2 then interval '5 minutes'
                                       else        interval '30 minutes'
                                     end)
   where d.id in (
     select c.id from app.notification_delivery c
     where c.channel = 'email' and c.status = 'pending'
       and c.next_attempt_at <= now() and c.attempts < c.max_attempts
     order by c.created_at
     for update skip locked
     limit greatest(p_max, 0)
   )
  returning d.*;
end;
$$;

-- mark sent — terminal success.
create or replace function app.mark_email_delivery_sent(p_id uuid, p_message_id text, p_response jsonb default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.notification_delivery
     set status = 'sent', sent_at = now(), provider = 'resend',
         provider_message_id = p_message_id,
         provider_response = coalesce(p_response, provider_response),
         last_error = null
   where id = p_id;
end;
$$;

-- mark failed — records the error; goes terminal 'failed' once max_attempts is exhausted, otherwise
-- stays 'pending' (claim already scheduled next_attempt_at for the retry).
create or replace function app.mark_email_delivery_failed(p_id uuid, p_error text, p_response jsonb default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.notification_delivery d
     set last_error = p_error, provider = 'resend',
         provider_response = coalesce(p_response, d.provider_response),
         status = case when d.attempts >= d.max_attempts then 'failed'::app.delivery_status
                       else 'pending'::app.delivery_status end
   where d.id = p_id;
end;
$$;

revoke all on function app.enqueue_email_deliveries(uuid)                  from public;
revoke all on function app.claim_email_deliveries(int)                     from public;
revoke all on function app.mark_email_delivery_sent(uuid, text, jsonb)     from public;
revoke all on function app.mark_email_delivery_failed(uuid, text, jsonb)   from public;
grant execute on function app.enqueue_email_deliveries(uuid)                to authenticated, service_role;
-- Drainer-only surface: service_role exclusively.
grant execute on function app.claim_email_deliveries(int)                   to service_role;
grant execute on function app.mark_email_delivery_sent(uuid, text, jsonb)   to service_role;
grant execute on function app.mark_email_delivery_failed(uuid, text, jsonb) to service_role;
