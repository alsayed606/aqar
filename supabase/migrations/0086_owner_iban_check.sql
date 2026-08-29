-- 0086_owner_iban_check.sql
-- The account the office actually sends money to, checked.
--
-- app.organization.iban has been format-checked since 0066. app.owner.iban never was — and that is
-- the one a remittance is paid into: it is printed on the RM- voucher and on the owner's statement,
-- and the office types the transfer from it.
--
-- Three ways in, and the least supervised is the widest: the Excel importer writes owner.iban
-- straight from the «الآيبان» column of a spreadsheet (0016, last rewritten in 0058). A hundred
-- owners can arrive in one upload with nothing between the sheet and the column.

-- ---------------------------------------------------------------------------
-- 1. Normalise before checking, and keep normalising
-- ---------------------------------------------------------------------------
-- A Saudi IBAN is written on paper in groups — "SA03 8000 0000 6080 1016 7519" — and that is how it
-- arrives in a spreadsheet and how a person types it. The application already strips spaces before
-- writing; the importer only trims the ends. Rejecting a correct number because of the spaces a
-- human put in it would be the constraint failing the user rather than the data.
--
-- A trigger rather than fixing the importer's expression: it covers every writer, including the
-- SQL editor and whatever is written next, and it does not require re-declaring a 200-line import
-- function to change one line of it.
update app.owner
   set iban = upper(regexp_replace(iban, '\s', '', 'g'))
 where iban is not null
   and iban <> upper(regexp_replace(iban, '\s', '', 'g'));

create or replace function app.tg_owner_normalise_iban() returns trigger
language plpgsql as $$
begin
  if new.iban is not null then
    new.iban := upper(regexp_replace(new.iban, '\s', '', 'g'));
    -- An emptied field means "no account", not an empty string that will fail the format check.
    if new.iban = '' then new.iban := null; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists owner_normalise_iban on app.owner;
create trigger owner_normalise_iban
  before insert or update of iban on app.owner
  for each row execute function app.tg_owner_normalise_iban();

-- ---------------------------------------------------------------------------
-- 2. The check
-- ---------------------------------------------------------------------------
-- NOT VALID, exactly as 0066 did for cr_number and vat_number: this file cannot see what a live
-- database already holds, and a migration that refuses to apply because one owner was recorded with
-- a wrong number is a migration that does not get applied at all.
--
-- What that means in practice, said plainly: existing rows are left alone, but every INSERT and
-- UPDATE from now on is checked — so an owner whose stored IBAN is genuinely malformed cannot be
-- edited at all until it is corrected, even to change their name. That is the same trade 0066 made,
-- and the loud version is the right one for a number money is sent to. app/app/owners/actions.ts
-- names owner_iban_chk in its refusal table so the office reads why.
--
-- Once the live data is known clean:
--   alter table app.owner validate constraint owner_iban_chk;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'owner_iban_chk') then
    alter table app.owner add constraint owner_iban_chk
      check (iban is null or iban ~ '^SA[0-9]{22}$') not valid;
  end if;
end
$do$;

comment on column app.owner.iban is
  'The owner''s payout account. Normalised to upper-case with whitespace removed on write (0086) and
   format-checked as ^SA[0-9]{22}$. Printed on the remittance voucher and the owner statement — this
   is the number the office transfers to.';

select app.record_migration('0086', 'owner_iban_check');
