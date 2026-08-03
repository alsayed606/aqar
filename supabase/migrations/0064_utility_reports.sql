-- 0064_utility_reports.sql
-- Utilities module, phase U-4: the two reports the API cannot express on its own.
--
-- Reports 1 and 2 (bills due, bills overdue) are filters on app.utility_bill_view and need nothing
-- here. Reports 3 and 4 do:
--   * Monthly consumption is a GROUP BY, and PostgREST cannot aggregate.
--   * "Meters needing attention" is a union of four anti-joins across four tables, which no
--     combination of query parameters can express either.
-- Both are views, not tables: nothing below stores a fact that could fall out of date with the
-- readings, bills and contracts it is computed from.
--
-- No new table, no column, no change to anything that exists. Purely additive.

-- ---------------------------------------------------------------------------
-- 1. Report 3 — monthly consumption per meter.
-- Consumption belongs to the month the meter was READ in, which is how a provider bills it.
-- ---------------------------------------------------------------------------
create or replace view app.utility_monthly_consumption
with (security_invoker = true) as
select
  c.org_id,
  c.meter_id,
  m.property_id,
  m.unit_id,
  m.utility_type,
  m.meter_number,
  m.meter_level,
  p.name as property_name,
  u.unit_number,
  date_trunc('month', c.reading_date)::date as month,
  -- NULL consumptions are skipped by sum(), so a month of nothing but baseline or flagged readings
  -- totals NULL rather than zero. Zero would read as "used nothing"; NULL reads as "not known",
  -- which is what it is.
  sum(c.consumption)                                      as consumption,
  count(*)                                                as reading_count,
  count(*) filter (where c.consumption is null)           as unknown_readings,
  count(*) filter (where c.needs_review)                  as flagged_readings
from app.utility_consumption c
join app.utility_meter m on m.id = c.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where m.deleted_at is null
group by c.org_id, c.meter_id, m.property_id, m.unit_id, m.utility_type, m.meter_number,
         m.meter_level, p.name, u.unit_number, date_trunc('month', c.reading_date);

-- ---------------------------------------------------------------------------
-- 2. Report 4 — meters needing attention.
--
-- The original "unlinked meters" report lost its meaning once meter_level became derived: a meter
-- with no unit IS a main meter, which is a correct state and not a defect. Every row below is
-- instead something a human has to go and do.
-- ---------------------------------------------------------------------------
create or replace view app.utility_attention
with (security_invoker = true) as

-- (a) An active meter nobody has read for two months, or ever. Two months is deliberately longer
-- than a monthly billing cycle, so a single late reading is not treated as neglect.
select
  m.org_id, m.property_id, m.id as meter_id, m.unit_id,
  'stale_reading'::text                as kind,
  m.utility_type, m.meter_number,
  p.name as property_name, u.unit_number,
  max(r.reading_date)                  as ref_date
from app.utility_meter m
join app.property p       on p.id = m.property_id
left join app.unit u      on u.id = m.unit_id
left join app.utility_reading r on r.meter_id = m.id and r.deleted_at is null
where m.deleted_at is null and m.status = 'active'
group by m.org_id, m.property_id, m.id, m.unit_id, m.utility_type, m.meter_number, p.name, u.unit_number
having max(r.reading_date) is null or max(r.reading_date) < current_date - 60

union all

-- (b) A bill with nothing behind it: no reading typed on the bill AND no reading recorded for that
-- meter inside the billed month. A bill that carries its own readings is backed, even without a
-- separate reading row — flagging those would bury the real cases in noise.
select
  b.org_id, m.property_id, m.id, m.unit_id,
  'bill_without_reading'::text,
  m.utility_type, m.meter_number,
  p.name, u.unit_number,
  b.billing_month
from app.utility_bill b
join app.utility_meter m on m.id = b.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where b.deleted_at is null and m.deleted_at is null
  and b.current_reading is null
  and not exists (
    select 1 from app.utility_reading r
     where r.meter_id = b.meter_id and r.deleted_at is null
       and r.reading_date >= b.billing_month
       and r.reading_date <  (b.billing_month + interval '1 month')::date
  )

union all

-- (c) A rented unit with no meter of its own. Meters are optional by design, so this is a prompt,
-- not an error: an office that bills utilities per unit wants to know which tenant it cannot.
-- A 'removed' meter does not count as coverage; an archived ('inactive') one does, since the meter
-- is still there.
select
  un.org_id, un.property_id, null::uuid, un.id,
  'rented_unit_without_meter'::text,
  null::text, null::text,
  p.name, un.unit_number,
  null::date
from app.unit un
join app.property p on p.id = un.property_id
where un.deleted_at is null and un.current_status = 'rented'
  and not exists (
    select 1 from app.utility_meter m
     where m.unit_id = un.id and m.deleted_at is null and m.status <> 'removed'
  )

union all

-- (d) A reading flagged lower-than-previous that nobody has resolved. This is the loose end the
-- consumption rule deliberately leaves: the system refuses to guess, so a person must answer.
select
  c.org_id, m.property_id, m.id, m.unit_id,
  'reading_needs_review'::text,
  m.utility_type, m.meter_number,
  p.name, u.unit_number,
  c.reading_date
from app.utility_consumption c
join app.utility_meter m on m.id = c.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where m.deleted_at is null and c.needs_review;

-- security_invoker on both views is what keeps a property-scoped member from reading another
-- property's meters through a report. Without it each view would run as its owner and answer
-- everything.
grant select on app.utility_monthly_consumption, app.utility_attention to authenticated;
