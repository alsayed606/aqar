-- 0015_financial_views.sql
-- Financial status is DERIVED here, never stored. §7 rule 1.
-- security_invoker = true (PG15+) so the querying user's RLS applies — a view must NOT become an
-- RLS bypass. Every view therefore only ever exposes the caller's own org rows.

-- ---------------------------------------------------------------------------
-- charge_balance — the atom. Gross due vs. allocated payments → balance / settled / overdue.
-- ---------------------------------------------------------------------------
create view app.charge_balance
  with (security_invoker = true) as
select
  c.id                                   as charge_id,
  c.org_id,
  c.property_id,
  c.unit_id,
  c.contract_id,
  c.charge_type,
  c.due_date,
  c.amount_excl_vat_halalas,
  c.vat_amount_halalas,
  c.amount_incl_vat_halalas              as gross_halalas,
  coalesce(a.allocated_halalas, 0)       as allocated_halalas,
  c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0) as balance_halalas,
  (c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0)) <= 0 as is_settled,
  (c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0)) > 0
    and c.due_date < current_date        as is_overdue
from app.charge c
left join (
  select charge_id, sum(amount_halalas) as allocated_halalas
  from app.payment_allocation
  group by charge_id
) a on a.charge_id = c.id
where c.deleted_at is null;

-- ---------------------------------------------------------------------------
-- contract_financial — per-contract rollup.
-- ---------------------------------------------------------------------------
create view app.contract_financial
  with (security_invoker = true) as
select
  cb.org_id,
  cb.contract_id,
  count(*)                                            as charge_count,
  sum(cb.gross_halalas)                               as total_due_halalas,
  sum(cb.allocated_halalas)                           as total_paid_halalas,
  sum(cb.balance_halalas)                             as balance_halalas,
  sum(case when cb.is_overdue then cb.balance_halalas else 0 end) as overdue_halalas,
  min(cb.due_date) filter (where not cb.is_settled)   as next_unpaid_due_date
from app.charge_balance cb
where cb.contract_id is not null
group by cb.org_id, cb.contract_id;

-- ---------------------------------------------------------------------------
-- unit_financial — per-unit rollup across its contracts/charges.
-- ---------------------------------------------------------------------------
create view app.unit_financial
  with (security_invoker = true) as
select
  cb.org_id,
  cb.unit_id,
  sum(cb.gross_halalas)     as total_due_halalas,
  sum(cb.allocated_halalas) as total_paid_halalas,
  sum(cb.balance_halalas)   as balance_halalas,
  sum(case when cb.is_overdue then cb.balance_halalas else 0 end) as overdue_halalas
from app.charge_balance cb
where cb.unit_id is not null
group by cb.org_id, cb.unit_id;

-- ---------------------------------------------------------------------------
-- payment_status — how much of each payment is still unallocated (a credit / on-account balance).
-- ---------------------------------------------------------------------------
create view app.payment_status
  with (security_invoker = true) as
select
  p.id                                        as payment_id,
  p.org_id,
  p.party_id,
  p.amount_halalas,
  coalesce(x.allocated_halalas, 0)            as allocated_halalas,
  p.amount_halalas - coalesce(x.allocated_halalas, 0) as unallocated_halalas
from app.payment p
left join (
  select payment_id, sum(amount_halalas) as allocated_halalas
  from app.payment_allocation
  group by payment_id
) x on x.payment_id = p.id
where p.deleted_at is null;

grant select on app.charge_balance, app.contract_financial, app.unit_financial, app.payment_status
  to authenticated, service_role;
