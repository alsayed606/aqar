-- 0079_maintenance_photos.sql
-- Somewhere for the photo the column has been expecting since 0072.
--
-- maintenance_request.photo_path has existed since 0072 and every request ever submitted set it to
-- null, because there was no bucket to put a file in and no form field to choose one. Meanwhile
-- "تسريب في المطبخ" means a dozen different faults, and the office answers it by sending someone to
-- look — a visit that one photograph would have replaced.
--
-- The logo bucket (0066) cannot be reused. Its policies ask is_member_of / is_org_admin, and the
-- person uploading here is a tenant: neither of those, and rightly so.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
-- Path: maintenance-photos/<org_id>/<party_id>/<request_id>.<ext>
--
-- The request is created FIRST and the photo attaches to it, rather than the file being uploaded and
-- the request built around it. The other order looks simpler and leaves rubbish behind: submission
-- can be refused after the upload — no active contract, the five-a-day allowance — and the tenant
-- cannot delete what they just uploaded, because deletion here is an office act. An orphan nobody is
-- allowed to remove is worse than one extra round trip.
--
-- The party id stays in the path even though the request id would be unique on its own: it is what
-- the write policy proves against, and it keeps a tenant inside their own folder.
--
-- Supabase-safe / CI-safe: the storage schema exists only on Supabase, so this whole block is
-- skipped on the bare Postgres the local harness boots, exactly as 0066 and 0017 do.
do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  -- 5 MB: a phone photograph is 2–5 MB, and a limit that rejects the ordinary case is a limit that
  -- turns "report the fault" into "give up". HEIC is deliberately absent — iOS converts on upload in
  -- practice, and the bucket refusing the rare exception is better than a file no browser can show.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('maintenance-photos', 'maintenance-photos', false, 5242880,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set
    public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists maintenance_photos_read   on storage.objects';
  execute 'drop policy if exists maintenance_photos_write  on storage.objects';
  execute 'drop policy if exists maintenance_photos_update on storage.objects';
  execute 'drop policy if exists maintenance_photos_delete on storage.objects';

  -- Read: any member of the owning office, plus the person whose folder it is.
  --
  -- Deliberately wider than the request's own RLS, which also confines a member to their scoped
  -- properties. This policy cannot see the request — the path names a party, not a fault — so the
  -- precise check lives in /api/maintenance/photo/[id], which reads the request through RLS first
  -- and only then downloads. The policy is the outer fence; the route is the exact one.
  execute $p$
    create policy maintenance_photos_read on storage.objects for select to authenticated
    using (
      bucket_id = 'maintenance-photos'
      and (
        app.is_member_of(app.uuid_or_null((storage.foldername(name))[1]))
        or app.party_is_mine(app.uuid_or_null((storage.foldername(name))[2]))
      )
    )$p$;

  -- Write: into your own folder, and only under the org that folder claims. Without the second
  -- condition a tenant could file their photograph under another office's id — harmless to that
  -- office's data, but it would put a stranger's picture inside their bucket.
  execute $p$
    create policy maintenance_photos_write on storage.objects for insert to authenticated
    with check (
      bucket_id = 'maintenance-photos'
      and app.party_is_mine(app.uuid_or_null((storage.foldername(name))[2]))
      and exists (
        select 1 from app.party p
        where p.id = app.uuid_or_null((storage.foldername(name))[2])
          and p.org_id = app.uuid_or_null((storage.foldername(name))[1])
      )
    )$p$;

  -- No update policy at all, for anyone. A photograph of a fault is evidence, and evidence that can
  -- be swapped after the report is not evidence. A corrected picture is a new object.
  --
  -- Delete is admins only: the office needs it for junk and, until the erasure sweep of item 3
  -- exists, for a data-subject request. The tenant cannot delete their own — a fault they reported
  -- and then thought better of showing is exactly the case the office must still be able to see.
  execute $p$
    create policy maintenance_photos_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'maintenance-photos'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;
end
$do$;

-- ---------------------------------------------------------------------------
-- Where the tenant is told to put it, and how it gets attached
-- ---------------------------------------------------------------------------
-- The tenant cannot read their own app.party row — that table is readable by office members — so the
-- application cannot build the path itself. This hands back exactly the prefix the write policy will
-- accept, and nothing else about the party.
create or replace function app.maintenance_photo_folder(p_tenant uuid)
returns text
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_folder text;
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select t.org_id::text || '/' || t.party_id::text into v_folder
  from app.tenant t where t.id = p_tenant;

  return v_folder;
end;
$$;

-- Attaching is a separate act because maintenance_request is not writable by a tenant, and should
-- not become writable by one. This is the whole of what they may change on it, once.
create or replace function app.attach_maintenance_photo(p_request uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_owner uuid;
  v_had   text;
begin
  select r.reported_by_party_id, r.photo_path into v_owner, v_had
  from app.maintenance_request r
  where r.id = p_request and r.deleted_at is null;

  if v_owner is null or not app.party_is_mine(v_owner) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  -- Once. A picture that can be replaced after the office has read it is not evidence of anything,
  -- and this function is reachable by the person with the most reason to replace it.
  if v_had is not null then
    raise exception 'PHOTO_ALREADY_SET' using errcode = 'raise_exception';
  end if;

  update app.maintenance_request set photo_path = p_path, updated_at = now()
   where id = p_request;
end;
$$;

-- 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public` closes
-- nothing. Revoke by name, then grant back deliberately.
revoke all on function app.maintenance_photo_folder(uuid)      from public, anon, authenticated;
revoke all on function app.attach_maintenance_photo(uuid, text) from public, anon, authenticated;
grant execute on function app.maintenance_photo_folder(uuid)      to authenticated;
grant execute on function app.attach_maintenance_photo(uuid, text) to authenticated;

-- And the tenant sees their own picture back. Not decoration: it is the only way to know the file
-- actually arrived, and a photo the sender cannot see is a photo they will send again by WhatsApp.
-- The flag is a boolean, not the path — the path names a folder they have no other business knowing.
drop function if exists app.tenant_portal_maintenance(uuid);

create or replace function app.tenant_portal_maintenance(p_tenant uuid)
returns table (
  id uuid, request_no text, category text, urgency app.maintenance_urgency,
  status app.maintenance_status, description text, unit_number text,
  has_photo boolean, created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select r.id, r.request_no, r.category, r.urgency, r.status, r.description,
           u.unit_number, r.photo_path is not null, r.created_at, r.resolved_at
    from app.maintenance_request r
    join app.unit   u on u.id = r.unit_id
    join app.tenant t on t.party_id = r.reported_by_party_id and t.id = p_tenant
    where r.deleted_at is null
    order by r.created_at desc;
end;
$$;

revoke all on function app.tenant_portal_maintenance(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_maintenance(uuid) to authenticated;

comment on column app.maintenance_request.photo_path is
  'Object path inside the private maintenance-photos bucket: <org_id>/<party_id>/<request_id>.<ext>. Served
   through /api/maintenance/photo/[id], never as a public or signed URL. NOT removed by the PDPL
   erasure of 0061 — SQL cannot delete a storage object; the office deletes it from the request.';

select app.record_migration('0079', 'maintenance_photos');
