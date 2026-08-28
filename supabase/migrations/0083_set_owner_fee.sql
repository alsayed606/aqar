-- 0083_set_owner_fee.sql
-- The management fee stops being edited in two halves.
--
-- setOwnerFee did this, in the application, with no transaction between the lines:
--
--   1. soft-delete the owner's live percentage agreement  -- and never looked at the result
--   2. insert the new one
--
-- Whichever half failed alone, the owner's fee came out wrong:
--
--   * step 1 refused (RLS: a member confined to certain properties matches no row and gets NO error,
--     because a policy does not raise — it matches nothing) and step 2 succeeds
--       => TWO live percentage agreements, and nothing says which one the statement should read.
--   * step 1 succeeds and step 2 fails
--       => the owner has NO fee agreement at all, and the previous one is already gone.
--
-- This is the office's commission. Two rows that must move together belong in one statement, and the
-- only place that can promise that is the database.

create or replace function app.set_owner_fee(p_owner uuid, p_percentage numeric)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  -- 0 and 100 are both real answers: a free management arrangement, and one that takes everything
  -- (a head-lease). Refusing them would be inventing a rule the business never stated.
  if p_percentage is null or p_percentage < 0 or p_percentage > 1 then
    raise exception 'INVALID_PERCENTAGE' using errcode = 'raise_exception';
  end if;

  select o.org_id into v_org from app.owner o where o.id = p_owner and o.deleted_at is null;
  if v_org is null then
    raise exception 'OWNER_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- SECURITY INVOKER on purpose: both writes below run as the caller, so the same RLS that guards
  -- every other write on these tables guards this one. A DEFINER here would hand any member the
  -- power to reprice any owner — the exact thing the policies exist to prevent. What the function
  -- adds is atomicity, not authority.
  update app.management_agreement
     set deleted_at = now(), deleted_reason = 'fee_update', updated_at = now()
   where owner_id = p_owner
     and fee_model = 'percentage_of_collection'
     and deleted_at is null;

  insert into app.management_agreement (org_id, owner_id, valid_from, fee_model, fee_percentage)
  values (v_org, p_owner, (now() at time zone 'Asia/Riyadh')::date, 'percentage_of_collection', p_percentage)
  returning id into v_id;

  -- Zero rows from the INSERT is impossible (it would have raised), but a refused UPDATE is silent.
  -- If the caller could not retire the old agreement, the insert above has just created the second
  -- one — so the whole thing is rolled back rather than left in the state this migration exists to
  -- prevent. plpgsql wraps the function body in the caller's transaction, so the raise undoes both.
  if exists (
    select 1 from app.management_agreement
     where owner_id = p_owner
       and fee_model = 'percentage_of_collection'
       and deleted_at is null
       and id <> v_id
  ) then
    raise exception 'FEE_UPDATE_REFUSED' using errcode = 'raise_exception';
  end if;

  return v_id;
end;
$$;

-- 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public` closes
-- nothing. Revoke by name, then grant back deliberately.
revoke all on function app.set_owner_fee(uuid, numeric) from public, anon, authenticated;
grant execute on function app.set_owner_fee(uuid, numeric) to authenticated;

select app.record_migration('0083', 'set_owner_fee');
