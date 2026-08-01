-- 0055_platform_fixes.sql
-- Two fixes from the clean-code-guard review of the platform console.
--
-- 1. platform_broadcast read an EXPLICITLY EMPTY audience as "everyone". The org list was collected
--    with array_agg over jsonb_array_elements, and array_agg over zero rows returns NULL — the same
--    NULL that the filter used to mean "no restriction". So {"orgs": []}, which says send to nobody,
--    reached every office on the platform. Absence and emptiness cannot be told apart by the value
--    alone, so presence of the key is now tracked separately.
--
--    Writing the test for that exposed a second fault in the same key: the ids were read with
--    `value::text::uuid`, and ::text on a jsonb string keeps its quotes, so every NON-empty list
--    raised. Between the two, {"orgs": …} had no correct input: empty reached everyone, non-empty
--    errored. Neither is reachable from the console today (the composer sends only status and plan)
--    — which is exactly why it needed fixing now, before the first caller finds the worst possible
--    failure mode in the least reversible action in the product.
--
-- 2. trial_days accepted 0. A zero-day trial provisions an office that is locked out the moment it
--    is created — subscription_active() sees an already-expired trial. The floor is 1.

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
    -- Only known keys. An open key-value store invites settings nothing reads.
    raise exception 'UNKNOWN_SETTING' using errcode = 'raise_exception';
  end if;
  -- Floor of 1: a zero-day trial creates an office that is locked out on arrival.
  if p_key = 'trial_days' and (jsonb_typeof(p_value) <> 'number'
       or (p_value)::text::int < 1 or (p_value)::text::int > 365) then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;
  if p_key = 'default_plan' and not exists (select 1 from app.plan where code = p_value #>> '{}') then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.platform_setting
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  perform app.write_audit(null, 'platform.setting_update', 'platform_setting', null,
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value));
end;
$$;

create or replace function app.platform_broadcast(
  p_title text,
  p_body text default null,
  p_audience jsonb default '{}'::jsonb,
  p_channel text default 'in_app',
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_status   text := p_audience->>'status';
  v_plan     text := p_audience->>'plan';
  -- Presence of the key, not the value: array_agg over an empty array yields NULL, which is
  -- indistinguishable from "the caller never asked to restrict by org".
  v_by_orgs  boolean := coalesce(p_audience ? 'orgs', false);
  v_orgs     uuid[] := '{}'::uuid[];
  v_ids      uuid[];
  v_emails   int := 0;
  v_id       uuid;
  v_note     uuid;
  v_bid      uuid;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'raise_exception';
  end if;
  if p_channel not in ('in_app', 'in_app_email') then
    raise exception 'INVALID_CHANNEL' using errcode = 'raise_exception';
  end if;

  if v_by_orgs then
    -- `value::text` on a jsonb string keeps its quotes ("…"), which is not a uuid; #>> '{}' unwraps
    -- the scalar. The original cast raised on every non-empty list, so between that and the empty
    -- list reaching everyone, this key had no correct input at all.
    select coalesce(array_agg((value #>> '{}')::uuid), '{}'::uuid[]) into v_orgs
      from jsonb_array_elements(p_audience->'orgs');
  end if;

  select array_agg(o.id) into v_ids
    from app.organization o
    left join app.org_subscription s on s.org_id = o.id
   where o.deleted_at is null
     and (v_status is null or s.status::text = v_status)
     and (v_plan   is null or s.plan_code = v_plan)
     and (not v_by_orgs or o.id = any(v_orgs));

  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- Count the mailboxes the same way the outbox will resolve them, so the number shown before
  -- sending is the number that actually receives it.
  if p_channel = 'in_app_email' then
    select count(*)::int into v_emails
      from app.membership m
      join app.identity i on i.id = m.identity_id and i.email is not null and i.status = 'active'
     where m.org_id = any(v_ids) and m.status = 'active' and m.deleted_at is null;
  end if;

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'orgs', cardinality(v_ids), 'emails', v_emails);
  end if;

  insert into app.broadcast (title, body, audience, channel, orgs_count, emails_count, sent_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), coalesce(p_audience, '{}'::jsonb),
          p_channel, cardinality(v_ids), v_emails, auth.uid())
  returning id into v_bid;

  foreach v_id in array v_ids loop
    insert into app.notification (org_id, kind, title, body, entity_type, entity_id)
    values (v_id, 'platform_broadcast', btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), 'broadcast', v_bid)
    returning id into v_note;
    if p_channel = 'in_app_email' then
      perform app.enqueue_notification_email(v_note);
    end if;
  end loop;

  perform app.write_audit(null, 'platform.broadcast', 'broadcast', v_bid, jsonb_build_object(
    'title', btrim(p_title), 'channel', p_channel, 'audience', p_audience,
    'orgs', cardinality(v_ids), 'emails', v_emails));

  return jsonb_build_object('dry_run', false, 'broadcast_id', v_bid,
                            'orgs', cardinality(v_ids), 'emails', v_emails);
end;
$$;

revoke all on function app.operator_set_setting(text, jsonb)                   from public;
revoke all on function app.platform_broadcast(text, text, jsonb, text, boolean) from public;
grant execute on function app.operator_set_setting(text, jsonb)                to authenticated, service_role;
grant execute on function app.platform_broadcast(text, text, jsonb, text, boolean) to authenticated, service_role;
