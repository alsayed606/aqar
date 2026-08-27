-- 0080_photo_erasure_sweep.sql
-- Making the erasure promise true for photographs, and closing the orphan our own error path opens.
--
-- 0079 shipped with a written admission: PDPL erasure (0061) is SQL, and SQL cannot delete a storage
-- object, so a photograph of someone's kitchen outlived the erasure of the person who sent it unless
-- an admin remembered to press a button. An admission is better than a false promise; it is not as
-- good as keeping the promise.
--
-- Two defects, and they do NOT have the same cure:
--
--   1. The photograph of an erased party. Deleting the file needs the storage API, which is Node, so
--      the database can only NOMINATE — the daily drain does the deleting.
--   2. A file uploaded whose attach then failed ("الصورة رُفعت ولم تُربط بالطلب"). That one is not a
--      sweep problem at all: it exists because the tenant was forbidden to clean up after themselves.
--      A policy fixes it at the source, and no orphan is created in the first place.

-- ---------------------------------------------------------------------------
-- 1. The orphan: let the owner delete a file nothing points at
-- ---------------------------------------------------------------------------
-- Deletion stayed with admins in 0079 because an attached photograph is evidence, and the person
-- with the most reason to withdraw it must not be able to. That reasoning does not reach a file no
-- request references: it is evidence of nothing, and the only party inconvenienced by its removal is
-- the one who uploaded it by mistake.
do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  execute 'drop policy if exists maintenance_photos_delete on storage.objects';
  execute $p$
    create policy maintenance_photos_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'maintenance-photos'
      and (
        app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
        or (
          app.party_is_mine(app.uuid_or_null((storage.foldername(name))[2]))
          and not exists (
            select 1 from app.maintenance_request r
            where r.photo_path = storage.objects.name
          )
        )
      )
    )$p$;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. The erased party's photograph: nominate, then confirm
-- ---------------------------------------------------------------------------
-- Two functions rather than one because the deletion happens between them, in another process. The
-- column is cleared only after the object is actually gone: clearing it first would lose the only
-- record of which file to delete, and the picture would stay in the bucket with nothing pointing at
-- it and nothing left to find it by.
create or replace function app.claim_erased_photos(p_max int default 100)
returns table (request_id uuid, photo_path text)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select r.id, r.photo_path
  from app.maintenance_request r
  join app.party p on p.id = r.reported_by_party_id
  where r.photo_path is not null
    and p.erased_at is not null
  order by p.erased_at
  limit p_max;
$$;

-- Called once per file the drain actually removed. Not a batch: a partial failure must leave the
-- rows it could not delete exactly as they were, still nominated, to be retried tomorrow.
create or replace function app.mark_photo_purged(p_request uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  update app.maintenance_request set photo_path = null, updated_at = now()
   where id = p_request and photo_path is not null
  returning org_id into v_org;

  if v_org is not null then
    -- Audited because this is the erasure being completed, and "we deleted their photograph" is the
    -- half the office will be asked to evidence.
    perform app.write_audit(v_org, 'maintenance.photo_purged', 'maintenance_request', p_request,
                            jsonb_build_object('reason', 'party_erased'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately. Both are drain-only.
-- ---------------------------------------------------------------------------
revoke all on function app.claim_erased_photos(int)  from public, anon, authenticated;
revoke all on function app.mark_photo_purged(uuid)   from public, anon, authenticated;
grant execute on function app.claim_erased_photos(int) to service_role;
grant execute on function app.mark_photo_purged(uuid)  to service_role;

-- 0079 wrote its own limitation onto the column, and that sentence is now false. A comment that
-- describes a gap which has been closed is worse than no comment: the next reader trusts it and
-- writes the manual cleanup all over again.
comment on column app.maintenance_request.photo_path is
  'Object path inside the private maintenance-photos bucket: <org_id>/<party_id>/<request_id>.<ext>.
   Served through /api/maintenance/photo/[id], never as a public or signed URL. Erasure of the
   reporting party nominates it (0080); the daily drain deletes the object and only then clears this
   column, so a null here means the file is actually gone.';

select app.record_migration('0080', 'photo_erasure_sweep');
