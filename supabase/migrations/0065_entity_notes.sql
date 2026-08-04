-- 0065_entity_notes.sql
-- Internal notes on the persistent entities (§6.1 of the design system): tenant, owner, property.
--
-- "Append-only, authored, internal" — one implementation reused by all three, never a per-module
-- variant. A note records what an office decided or observed; editing one later would let the
-- record disagree with what was actually known at the time, which is the whole reason to keep it.
--
-- Not attached to contracts, invoices or receipts: those are documents, not persistent entities.
-- A correction to a document is a document (an amendment, a credit note), not a note.

-- ---------------------------------------------------------------------------
-- 1. Additive unique keys so a note can be tied to a parent AND to that parent's org in one
-- foreign key. Same technique as 0063: the database proves a note cannot be attached to an entity
-- belonging to a different office, rather than a trigger or the application promising it.
-- ---------------------------------------------------------------------------
alter table app.tenant   drop constraint if exists tenant_id_org_uq;
alter table app.tenant   add  constraint tenant_id_org_uq   unique (id, org_id);
alter table app.owner    drop constraint if exists owner_id_org_uq;
alter table app.owner    add  constraint owner_id_org_uq    unique (id, org_id);
alter table app.property drop constraint if exists property_id_org_uq;
alter table app.property add  constraint property_id_org_uq unique (id, org_id);

-- ---------------------------------------------------------------------------
-- 2. The note.
-- ---------------------------------------------------------------------------
create table if not exists app.entity_note (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organization(id) on delete cascade,

  -- Exactly one of these is set. Three nullable columns with real foreign keys beat one
  -- (entity_type, entity_id) pair: a polymorphic pair cannot be a foreign key at all, so nothing
  -- would stop a note pointing at a row that no longer exists.
  tenant_id   uuid,
  owner_id    uuid,
  property_id uuid,

  body        text not null check (length(btrim(body)) > 0),

  -- Stamped by the trigger below from the session, never taken from the request.
  created_by  uuid references app.identity(id),
  created_at  timestamptz not null default now(),

  -- PDPL: a note is free text an office typed about a person, so it can carry personal data and
  -- must be reachable by erasure. These record that it happened rather than deleting the row,
  -- keeping the note's position in the timeline honest.
  redacted_at     timestamptz,
  redacted_reason text,

  constraint entity_note_one_target check (
    (tenant_id is not null)::int + (owner_id is not null)::int + (property_id is not null)::int = 1
  ),
  foreign key (tenant_id, org_id)   references app.tenant   (id, org_id) on delete cascade,
  foreign key (owner_id, org_id)    references app.owner    (id, org_id) on delete cascade,
  foreign key (property_id, org_id) references app.property (id, org_id) on delete cascade
);

create index if not exists entity_note_tenant_idx   on app.entity_note (tenant_id, created_at desc) where tenant_id is not null;
create index if not exists entity_note_owner_idx    on app.entity_note (owner_id, created_at desc) where owner_id is not null;
create index if not exists entity_note_property_idx on app.entity_note (property_id, created_at desc) where property_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Authorship comes from the session, not the payload.
-- ---------------------------------------------------------------------------
create or replace function app.tg_entity_note_author() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  -- A signed-in caller always authors as themselves; a claimed author in the request is discarded.
  -- When there is no session (seeding, an import running as a privileged role) the supplied value
  -- stands, because there is no one to attribute it to.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists entity_note_author on app.entity_note;
create trigger entity_note_author before insert on app.entity_note
  for each row execute function app.tg_entity_note_author();

-- ---------------------------------------------------------------------------
-- 4. Append-only, for users.
--
-- Unlike app.audit_log, this one is not absolute: PDPL erasure has to be able to redact a note's
-- body, and purging an organization has to be able to delete its rows. Both of those run as a
-- privileged role inside a SECURITY DEFINER function. What must never happen is a member editing
-- or deleting a note, and the role test is what forbids exactly that.
--
-- Note the 0053 rule applies to the grants below: `revoke ... from public` would NOT close this,
-- because 0001 sets default privileges for authenticated. The protection here is that UPDATE and
-- DELETE are never granted, with this trigger as the belt if that ever changes by accident.
-- ---------------------------------------------------------------------------
create or replace function app.tg_entity_note_immutable() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'NOTE_APPEND_ONLY: a note cannot be edited or deleted once written'
      using errcode = 'raise_exception';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists entity_note_immutable on app.entity_note;
create trigger entity_note_immutable before update or delete on app.entity_note
  for each row execute function app.tg_entity_note_immutable();

-- ---------------------------------------------------------------------------
-- 5. RLS — each note inherits the scope of the thing it is attached to. A member restricted to
-- certain properties must not read notes on the others, exactly as they cannot read the property.
-- ---------------------------------------------------------------------------
alter table app.entity_note enable row level security;
grant select, insert on app.entity_note to authenticated;

create policy entity_note_read on app.entity_note for select
  using (
    case when property_id is not null
         then app.has_property_access(org_id, property_id)
         else app.has_org_access(org_id) end
  );

create policy entity_note_write on app.entity_note for insert
  with check (
    case when property_id is not null
         then app.has_property_access(org_id, property_id)
         else app.has_org_access(org_id) end
  );

-- ---------------------------------------------------------------------------
-- 6. Erasure reaches the notes. Without this, a party could be erased everywhere else while a note
-- naming them stayed readable — which would make the erasure a claim rather than a fact.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party_notes(p_org uuid, p_party uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  affected integer;
begin
  update app.entity_note n
     set body = '[محذوف بطلب صاحب البيانات]',
         redacted_at = now(),
         redacted_reason = p_reason
   where n.org_id = p_org
     and n.redacted_at is null
     and (
       n.tenant_id in (select t.id from app.tenant t where t.org_id = p_org and t.party_id = p_party)
       or
       n.owner_id  in (select o.id from app.owner  o where o.org_id = p_org and o.party_id = p_party)
     );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- SECURITY DEFINER with no authorization check of its own, so it must not be callable by a member.
-- Per the 0053 rule this has to name both roles: revoking from public would leave the default
-- privileges granted in 0001 untouched.
revoke all on function app.erase_party_notes(uuid, uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Re-emit app.erase_party so the erasure includes the notes. Copied from 0061 with one added
-- call and the count reported back, so an office can tell the data subject exactly what went.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party(p_org uuid, p_party uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_active int;
  v_invoices int;
  v_notes int;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- A live tenancy is a contract in force. Erasing the counterparty to a running lease is not a
  -- privacy request the office can grant; end the contract first.
  select count(*) into v_active
    from app.contract c join app.tenant t on t.id = c.tenant_id
   where c.org_id = p_org and t.party_id = p_party and c.status = 'active' and c.deleted_at is null;
  if v_active > 0 then
    raise exception 'ERASE_ACTIVE_CONTRACT: % active contract(s) reference this party', v_active
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_invoices from app.invoice where org_id = p_org and buyer_party_id = p_party;

  update app.party
     set display_name   = 'بيانات محذوفة',
         national_id    = null, iqama_id = null, passport_no = null,
         cr_number      = null, vat_number = null, unified_number = null, cr_expiry = null,
         phone_e164     = null, phone_raw = null, email = null,
         rep_name       = null, rep_id_number = null, rep_capacity = null,
         rep_phone_e164 = null, rep_phone_raw = null,
         id_exempt_reason = null,
         -- Unlink the portal login so the erased record can never be signed into again.
         identity_id    = null,
         erased_at      = now(),
         erased_reason  = p_reason
   where id = p_party;

  -- The signing representative recorded on each contract is personal data too. These columns sit
  -- outside tg_contract_immutable's frozen set (0042), so an activated contract keeps its legal
  -- and financial terms while the person's details go.
  update app.contract c
     set representative_name = null, representative_capacity = null,
         representative_id   = null, representative_phone = null
    from app.tenant t
   where t.id = c.tenant_id and t.party_id = p_party and c.org_id = p_org;

  update app.trade_name set deleted_at = now(), deleted_reason = 'pdpl_erasure'
   where party_id = p_party and deleted_at is null;

  -- Internal notes are free text an office typed about this person (0065).
  v_notes := app.erase_party_notes(p_org, p_party, p_reason);

  perform app.write_audit(p_org, 'pdpl.erase_party', 'party', p_party,
                          jsonb_build_object('reason', p_reason, 'invoices_retained', v_invoices,
                                             'notes_redacted', v_notes));

  -- Reported, not hidden: the office has to be able to tell the data subject what was kept and why.
  return jsonb_build_object('erased', true, 'invoices_retained', v_invoices,
                            'notes_redacted', v_notes);
end;
$$;
