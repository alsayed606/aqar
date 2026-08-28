-- 0084_set_member_scope.sql
-- A member's property scope stops being rebuilt in three separate writes.
--
-- setMemberScope did this from the application, with nothing holding the three together:
--
--   1. membership.scope_all = false
--   2. delete every membership_property_scope row for that member
--   3. insert the chosen ones
--
-- Stop after 2 — an insert that fails, a connection that drops — and the member is left scoped to
-- NOTHING: they open the app and their portfolio is empty. The direction is safe (they lose access
-- rather than gain it), but the admin is looking at an error message and reasonably concludes that
-- nothing changed, while their colleague is locked out until someone thinks to look.
--
-- Three writes that describe one decision belong in one statement.

create or replace function app.set_member_scope(
  p_membership   uuid,
  p_scope_all    boolean,
  p_property_ids uuid[] default '{}'
)
returns void
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  select m.org_id into v_org from app.membership m where m.id = p_membership;
  if v_org is null then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- SECURITY INVOKER, like 0083: every write below runs as the caller, so membership_update and
  -- membership_scope_write (both is_org_admin) still decide who may do this. The function adds
  -- atomicity, not authority — a DEFINER here would hand any member the power to re-scope anyone.

  -- Belt and braces: membership_scope_write only proves the MEMBERSHIP belongs to an org the caller
  -- administers; it says nothing about the properties. Without this, a crafted request could grant a
  -- member scope over another office's property — invisible in the UI, which only ever offers the
  -- org's own, and therefore exactly the kind of thing that is never noticed.
  if p_property_ids is not null and array_length(p_property_ids, 1) is not null then
    if exists (
      select 1 from unnest(p_property_ids) as pid
      where not exists (
        select 1 from app.property p
        where p.id = pid and p.org_id = v_org and p.deleted_at is null
      )
    ) then
      raise exception 'PROPERTY_NOT_IN_ORG' using errcode = 'raise_exception';
    end if;
  end if;

  update app.membership set scope_all = p_scope_all, updated_at = now()
   where id = p_membership;

  -- A refused UPDATE is silent — it matches zero rows and raises nothing (the trap this codebase
  -- documents in lib/rpc-errors). Checking it here is what stops the two writes below from running
  -- on behalf of someone who was not allowed to make the first one.
  if not found then
    raise exception 'SCOPE_UPDATE_REFUSED' using errcode = 'raise_exception';
  end if;

  delete from app.membership_property_scope where membership_id = p_membership;

  -- Only when scoped. scope_all = true means the rows are meaningless, and leaving them behind would
  -- be a second answer to a question the flag already settles.
  if not p_scope_all and p_property_ids is not null then
    insert into app.membership_property_scope (membership_id, property_id)
    select p_membership, pid from unnest(p_property_ids) as pid
    on conflict do nothing;
  end if;
end;
$$;

-- 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public` closes
-- nothing. Revoke by name, then grant back deliberately.
revoke all on function app.set_member_scope(uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function app.set_member_scope(uuid, boolean, uuid[]) to authenticated;

select app.record_migration('0084', 'set_member_scope');
