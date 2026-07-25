-- 0037_identity_email.sql
-- Sprint E: allow EMAIL-first accounts. Until now app.identity required a KSA mobile, and the
-- auth→profile trigger only provisioned an identity when a valid phone was present — so an
-- email-only Supabase Auth user got NO identity row and could not create an org (FK on membership).
--
-- This migration makes phone OPTIONAL (email OR phone as the global key) and teaches the profile
-- trigger to provision email users. It is deliberately future-proof: nothing here assumes email
-- confirmation is off — turning it ON later is a Supabase dashboard toggle, not a code change (the
-- trigger fires on the auth.users insert regardless of confirmation state). Idempotent.

-- Phone is no longer mandatory. NOTE: the existing format CHECK (phone_e164 ~ '^\+9665…') already
-- passes for NULL (a CHECK is satisfied when it evaluates to NULL), so it keeps validating a phone
-- only when one is present — no need to touch it.
alter table app.identity alter column phone_e164 drop not null;

-- Contact floor: every identity must be reachable by at least one global key (phone OR email).
-- Existing rows all have a phone (it was NOT NULL until now), so the constraint holds on backfill.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'identity_contact_present') then
    alter table app.identity
      add constraint identity_contact_present check (phone_e164 is not null or email is not null);
  end if;
end $$;

comment on table app.identity is
  'Global person. id = auth.uid(). Reachable by phone_e164 OR email (at least one); both unique.';

-- Profile creator, now email-aware. Provisions an identity when we have EITHER a valid KSA mobile
-- OR an email, carrying full_name through from signup metadata when supplied. Single provisioning
-- point (unchanged contract) so enabling email confirmation / password reset later needs no change.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  if v_phone is not null or new.email is not null then
    insert into app.identity (id, phone_e164, phone_raw, email, full_name)
    values (
      new.id, v_phone, new.phone, new.email,
      nullif(new.raw_user_meta_data ->> 'full_name', '')
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;
