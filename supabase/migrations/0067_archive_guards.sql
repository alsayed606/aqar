-- 0067_archive_guards.sql
-- "Delete" in this product has always meant soft-delete: set deleted_at, keep the row, keep the
-- history. What it never did was ask whether anything still depended on the row.
--
-- app.deleteProperty soft-deleted a property with active contracts and units without a word. The
-- contracts stayed alive, pointing at a property that no longer appeared anywhere — no error, no
-- warning, and no way for the office to notice until a number stopped adding up.
--
-- This file makes the refusal explicit. It is a data-integrity rail, not an authorization boundary:
-- RLS decides WHO may archive, this decides WHETHER the row is ready to be archived. The message
-- carries counts so the screen can say what is in the way instead of just "no".

-- ---------------------------------------------------------------------------
-- The one legitimate cascade: import_revert undoes a whole committed batch, and walks the rows it
-- created in no particular order — so it will reach a property before that property's units. It
-- announces itself with a transaction-local flag, the same shape as app.allow_org_purge (0061).
--
-- Unlike the purge flag this one does NOT require a non-authenticated role, because import_revert
-- is SECURITY INVOKER and genuinely runs as `authenticated`. It is still not something a client can
-- set: PostgREST exposes only functions in the `app` schema, and set_config is not one of them.
-- ---------------------------------------------------------------------------
create or replace function app.archive_cascade_in_progress() returns boolean
language sql stable set search_path = app, pg_temp as $$
  select coalesce(current_setting('app.allow_cascade_archive', true), '') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- The guard. One function for five tables; it only reacts to the null → timestamp transition of
-- deleted_at, so ordinary edits (and un-archiving) pass straight through.
--
-- The message is structured — HAS_DEPENDENTS:units=3;contracts=2 — because the office needs to read
-- "٣ وحدات وعقدان" in Arabic, and a prose message in English cannot be turned back into that.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: the counts must be the TRUTH, not the caller's view of it. A member
-- scoped to a subset of properties would otherwise count zero contracts on a property whose
-- contracts RLS hides from them, and the guard would wave through exactly the orphaning it exists
-- to prevent. It leaks nothing either way — the only thing it can report is how many rows hang off
-- a row the caller is already permitted to archive.
create or replace function app.tg_block_archive_with_dependents() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  n_units     int;
  n_contracts int;
  n_props     int;
begin
  -- Not an archive: either it was already archived, or deleted_at is being cleared/left alone.
  if old.deleted_at is not null or new.deleted_at is null then
    return new;
  end if;

  if app.archive_cascade_in_progress() then
    return new;
  end if;

  case tg_table_name
    when 'property' then
      select count(*) into n_units     from app.unit     where property_id = old.id and deleted_at is null;
      select count(*) into n_contracts from app.contract where property_id = old.id and deleted_at is null;
      if n_units > 0 or n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:units=%;contracts=%', n_units, n_contracts
          using errcode = 'raise_exception';
      end if;

    when 'unit' then
      select count(*) into n_contracts from app.contract where unit_id = old.id and deleted_at is null;
      if n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:contracts=%', n_contracts using errcode = 'raise_exception';
      end if;

    when 'tenant' then
      select count(*) into n_contracts from app.contract where tenant_id = old.id and deleted_at is null;
      if n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:contracts=%', n_contracts using errcode = 'raise_exception';
      end if;

    when 'owner' then
      -- The self-owner is created with the organization (0013) and is what issue_invoice reads the
      -- supplier identity from for owned properties. Archiving it breaks invoicing silently, and no
      -- office ever means to: it is not a client, it is the office itself.
      if old.is_self then
        raise exception 'SELF_OWNER_UNDELETABLE' using errcode = 'raise_exception';
      end if;
      select count(*) into n_props from app.property where owner_id = old.id and deleted_at is null;
      if n_props > 0 then
        raise exception 'HAS_DEPENDENTS:properties=%', n_props using errcode = 'raise_exception';
      end if;

    when 'contract' then
      -- An ACTIVE contract is a live obligation with a charge schedule behind it and a unit marked
      -- rented in front of it. The way out is an early-termination amendment (0027), which settles
      -- both; archiving would leave the schedule running and the unit occupied forever.
      if old.status = 'active' then
        raise exception 'CONTRACT_ACTIVE_ARCHIVE' using errcode = 'raise_exception';
      end if;

    else
      null;
  end case;

  return new;
end;
$$;

drop trigger if exists block_archive_with_dependents on app.property;
create trigger block_archive_with_dependents before update on app.property
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.unit;
create trigger block_archive_with_dependents before update on app.unit
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.tenant;
create trigger block_archive_with_dependents before update on app.tenant
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.owner;
create trigger block_archive_with_dependents before update on app.owner
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.contract;
create trigger block_archive_with_dependents before update on app.contract
  for each row execute function app.tg_block_archive_with_dependents();

-- ---------------------------------------------------------------------------
-- import_revert, re-emitted unchanged except for the flag. Undoing a whole batch is the one place
-- where archiving a parent before its children is correct rather than a mistake.
-- ---------------------------------------------------------------------------
create or replace function app.import_revert(p_batch uuid, p_reason text default 'import_revert') returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org uuid;
  r     app.import_row;
begin
  select org_id into v_org from app.import_batch where id = p_batch and status = 'committed';
  if v_org is null then
    raise exception 'IMPORT_NOT_COMMITTED' using errcode = 'raise_exception';
  end if;

  -- Transaction-local: it lapses at commit, so it cannot leak into a later statement.
  perform set_config('app.allow_cascade_archive', 'on', true);

  for r in select * from app.import_row where batch_id = p_batch and created_entity_id is not null loop
    execute format(
      'update app.%I set deleted_at = now(), deleted_by = %L, deleted_reason = %L where id = %L',
      r.created_entity_type, auth.uid(), p_reason, r.created_entity_id);
  end loop;

  perform set_config('app.allow_cascade_archive', 'off', true);

  update app.import_batch set status = 'reverted', reverted_at = now(), reverted_by = auth.uid()
    where id = p_batch;
  perform app.write_audit(v_org, 'import.revert', 'import_batch', p_batch, '{}'::jsonb);
end;
$$;

-- No revoke on archive_cascade_in_progress: per the 0053 rule a `revoke ... from public` would be
-- theatre anyway (0001 grants execute to anon/authenticated by default privilege), and there is
-- nothing here to close — it reports one boolean about the caller's own session setting.
grant execute on function app.import_revert(uuid, text) to authenticated, service_role;
