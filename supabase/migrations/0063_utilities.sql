-- 0063_utilities.sql
-- Utilities module, phase U-1: meters, readings, bills. See docs/foundation/09-utilities-module.md.
--
-- Three decisions govern everything here:
--   1. ONE meter entity with a utility_type, not a table per utility. Electricity and water have
--      identical fields; two tables would duplicate every query, report and RLS policy, and then a
--      third would arrive for gas. utility_type is TEXT + CHECK rather than an enum because
--      `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which would break the
--      one-shot SQL-Editor apply this project relies on.
--   2. Who bears a bill is DERIVED from the contracts that already exist, never entered. A field a
--      human types will contradict the contracts; a field derived from them cannot.
--   3. NO financial effect. Nothing here writes a charge, a payment or an owner statement. That is
--      what makes "without changing the existing financial models" true literally rather than
--      loosely. Linking bills to charges is a separate, later decision.

-- ---------------------------------------------------------------------------
-- 1. The one change to an existing table: a unique index that lets a composite foreign key prove a
-- unit belongs to the meter's property. Purely additive — no behaviour changes for anything today.
-- ---------------------------------------------------------------------------
alter table app.unit drop constraint if exists unit_id_property_uq;
alter table app.unit add constraint unit_id_property_uq unique (id, property_id);

-- ---------------------------------------------------------------------------
-- 2. The meter.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_meter (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  -- Denormalised beside unit_id on purpose, the same way app.contract carries both: RLS needs the
  -- property scope directly, and a join to reach it would run on every policy check.
  property_id    uuid not null references app.property(id),
  unit_id        uuid,                       -- NULL = a main meter for the whole property
  utility_type   text not null check (utility_type in ('electricity', 'water')),
  meter_number   text not null,
  account_number      text,
  subscription_number text,
  provider       text,
  installed_at   date,
  removed_at     date,
  status         text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  notes          text,
  -- Derived, never entered. A field that CAN contradict reality eventually will.
  meter_level    text generated always as (case when unit_id is null then 'main' else 'unit' end) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text,
  -- MATCH SIMPLE (the default) skips the check when any column is NULL, so a main meter passes
  -- while a unit meter is proven to sit in this meter's own property.
  foreign key (unit_id, property_id) references app.unit (id, property_id),
  -- 'removed' and a removal date are the same fact; storing both invites them to disagree.
  constraint utility_meter_removed_chk check ((status = 'removed') = (removed_at is not null))
);

-- A meter number is issued by the provider and does not repeat within one office and utility.
create unique index if not exists utility_meter_number_uq
  on app.utility_meter (org_id, utility_type, meter_number) where deleted_at is null;
create index if not exists utility_meter_property_idx
  on app.utility_meter (org_id, property_id) where deleted_at is null;
create index if not exists utility_meter_unit_idx
  on app.utility_meter (unit_id) where unit_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Readings. is_reset is what makes the consumption rule decidable — see §3 of the design note.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_reading (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  meter_id       uuid not null references app.utility_meter(id) on delete cascade,
  reading_date   date not null,
  value          numeric(14,3) not null check (value >= 0),
  -- "The meter was replaced and restarted at zero." The ONLY way a lower reading is ever treated
  -- as legitimate, and it has to be said explicitly by a person.
  is_reset       boolean not null default false,
  note           text,
  created_by     uuid references app.identity(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text,
  unique (meter_id, reading_date)
);

create index if not exists utility_reading_meter_idx
  on app.utility_reading (meter_id, reading_date desc) where deleted_at is null;

-- current_date is STABLE, not IMMUTABLE, so a future-date rule cannot live in a CHECK constraint.
create or replace function app.tg_utility_reading_guard() returns trigger
language plpgsql as $$
begin
  if new.reading_date > current_date then
    raise exception 'READING_IN_FUTURE: a meter cannot be read on a date that has not happened'
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists utility_reading_guard on app.utility_reading;
create trigger utility_reading_guard before insert or update on app.utility_reading
  for each row execute function app.tg_utility_reading_guard();

-- ---------------------------------------------------------------------------
-- 4. Bills.
-- No payment_status column: "paid" is paid_at being set, and "overdue" is unpaid past its due date.
-- A column that stores what can be derived drifts away from it.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_bill (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references app.organization(id) on delete cascade,
  meter_id           uuid not null references app.utility_meter(id) on delete cascade,
  billing_month      date not null,
  previous_reading   numeric(14,3),
  current_reading    numeric(14,3),
  amount_halalas     bigint not null default 0 check (amount_halalas >= 0),
  vat_halalas        bigint not null default 0 check (vat_halalas >= 0),
  other_fees_halalas bigint not null default 0 check (other_fees_halalas >= 0),
  total_halalas      bigint generated always as (amount_halalas + vat_halalas + other_fees_halalas) stored,
  -- Same four-branch rule as readings, applied within one row (both readings are on the bill).
  consumption        numeric(14,3) generated always as (
                       case when previous_reading is null or current_reading is null then null
                            when current_reading >= previous_reading then current_reading - previous_reading
                            else null end) stored,
  needs_review       boolean generated always as (
                       previous_reading is not null and current_reading is not null
                       and current_reading < previous_reading) stored,
  due_date           date,
  paid_at            date,
  notes              text,
  created_by         uuid references app.identity(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  deleted_reason     text,
  -- A billing month is a month, not a day inside one. Storing the 14th would silently split a
  -- month in two for every report that groups by it.
  constraint utility_bill_month_chk check (billing_month = date_trunc('month', billing_month)::date)
);

create unique index if not exists utility_bill_month_uq
  on app.utility_bill (meter_id, billing_month) where deleted_at is null;
create index if not exists utility_bill_org_month_idx
  on app.utility_bill (org_id, billing_month desc) where deleted_at is null;
create index if not exists utility_bill_due_idx
  on app.utility_bill (org_id, due_date) where paid_at is null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5. updated_at, RLS and grants. Property-scoped, exactly like app.contract: a member restricted to
-- certain properties must not see meters belonging to the others.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['utility_meter', 'utility_reading', 'utility_bill'] loop
    execute format('drop trigger if exists %I_set_updated_at on app.%I;', t, t);
    execute format('create trigger %I_set_updated_at before update on app.%I
                      for each row execute function app.set_updated_at();', t, t);
    execute format('alter table app.%I enable row level security;', t);
    execute format('grant select, insert, update on app.%I to authenticated;', t);
  end loop;
end $$;

drop policy if exists utility_meter_all on app.utility_meter;
create policy utility_meter_all on app.utility_meter for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- Readings and bills hang off a meter, so their scope is the meter's scope. Re-deriving the
-- property here would let the two drift apart the day a meter moves.
drop policy if exists utility_reading_all on app.utility_reading;
create policy utility_reading_all on app.utility_reading for all
  using (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)))
  with check (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)));

drop policy if exists utility_bill_all on app.utility_bill;
create policy utility_bill_all on app.utility_bill for all
  using (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)))
  with check (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)));

-- ---------------------------------------------------------------------------
-- 6. Consumption, derived. §3 of the design note in four branches.
--
-- security_invoker is not optional here: without it a view runs with its OWNER's rights and hands
-- every office's readings to every caller, bypassing the policies above entirely.
-- ---------------------------------------------------------------------------
create or replace view app.utility_consumption
with (security_invoker = true) as
select
  r.id, r.org_id, r.meter_id, r.reading_date, r.value, r.is_reset, r.note, r.created_at,
  lag(r.value) over w as previous_value,
  case
    -- A replaced meter restarted at zero, so the reading IS the usage since.
    when r.is_reset                              then r.value
    -- No earlier reading: this is a BASELINE. We do not know where the meter started.
    when lag(r.value) over w is null             then null
    when r.value >= lag(r.value) over w          then r.value - lag(r.value) over w
    -- Lower than the last one and not declared a reset. We refuse to guess — see below.
    else null
  end as consumption,
  (not r.is_reset
   and lag(r.value) over w is not null
   and r.value < lag(r.value) over w) as needs_review
from app.utility_reading r
where r.deleted_at is null
window w as (partition by r.meter_id order by r.reading_date);

-- Why the last branch refuses instead of assuming a rollover: a digital meter has five or six
-- digits, so wrapping needs consumption no dwelling produces, while a lower reading is nearly
-- always a typo or an unrecorded meter swap. Computing (max - previous) + current would turn a
-- typing mistake into a plausible-looking bill — worse than a blank, because a blank gets noticed
-- and a plausible number does not.

-- ---------------------------------------------------------------------------
-- 7. Who bears each bill, derived. §4 of the design note.
-- ---------------------------------------------------------------------------
create or replace view app.utility_bill_view
with (security_invoker = true) as
select
  b.id, b.org_id, b.meter_id, b.billing_month, b.previous_reading, b.current_reading,
  b.consumption, b.needs_review, b.amount_halalas, b.vat_halalas, b.other_fees_halalas,
  b.total_halalas, b.due_date, b.paid_at, b.notes, b.created_at,
  m.utility_type, m.meter_number, m.meter_level, m.property_id, m.unit_id,
  p.name  as property_name,
  u.unit_number,
  (b.paid_at is not null)                                        as is_paid,
  (b.paid_at is null and b.due_date is not null
   and b.due_date < current_date)                                 as is_overdue,
  -- A main meter, or a unit standing empty that month, falls to the owner.
  case when c.tenant_party_id is not null then 'tenant' else 'owner' end as bearer_kind,
  coalesce(c.tenant_party_id, op.id)                              as bearer_party_id,
  coalesce(c.tenant_name, op.display_name)                         as bearer_name,
  c.contract_id,
  coalesce(c.overlapping > 1, false)                               as bearer_ambiguous
from app.utility_bill b
join app.utility_meter m on m.id = b.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
left join app.owner o    on o.id = p.owner_id
left join app.party op   on op.id = o.party_id
-- The contract in force on the LAST DAY of the billed month — not today. A bill for March belongs
-- to March's tenant even after they have moved out; resolving against "now" would hand the new
-- tenant their predecessor's bills.
left join lateral (
  select ct.id as contract_id, tp.id as tenant_party_id, tp.display_name as tenant_name,
         count(*) over () as overlapping
    from app.contract ct
    join app.tenant tn on tn.id = ct.tenant_id
    join app.party  tp on tp.id = tn.party_id
   where m.unit_id is not null
     and ct.unit_id = m.unit_id
     and ct.deleted_at is null
     and ct.status <> 'cancelled'
     and ct.start_date <= (b.billing_month + interval '1 month - 1 day')::date
     and ct.end_date   >= (b.billing_month + interval '1 month - 1 day')::date
   order by ct.start_date desc
   limit 1
) c on true
where b.deleted_at is null;

grant select on app.utility_consumption, app.utility_bill_view to authenticated;
