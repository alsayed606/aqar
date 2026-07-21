-- 0020_owner_statement.sql
-- Owner account statement: for the owner's properties over a period, aggregate what was COLLECTED
-- (payments allocated to those properties' charges, by payment received_at), the management fee
-- (from the owner's percentage_of_collection ManagementAgreement, if any), the net due to the owner,
-- and the outstanding balance. SECURITY INVOKER so RLS + property scope apply to the caller.
-- Idempotent; no new tables.

create or replace function app.owner_statement(p_owner uuid, p_from date, p_to date)
returns table (
  property_id        uuid,
  property_name      text,
  collected_halalas  bigint,
  outstanding_halalas bigint,
  fee_halalas        bigint,
  net_halalas        bigint
)
language sql stable security invoker set search_path = app, pg_temp as $$
  with pct as (
    -- the owner's active percentage-of-collection fee that overlaps the period (0 if none)
    select coalesce(max(fee_percentage), 0)::numeric as p
    from app.management_agreement
    where owner_id = p_owner
      and fee_model = 'percentage_of_collection'
      and deleted_at is null
      and valid_from <= p_to
      and (valid_to is null or valid_to >= p_from)
  ),
  props as (
    select id, name from app.property where owner_id = p_owner and deleted_at is null
  ),
  collected as (
    select c.property_id, sum(a.amount_halalas)::bigint as amt
    from app.payment_allocation a
    join app.payment p on p.id = a.payment_id and p.deleted_at is null
    join app.charge  c on c.id = a.charge_id
    where c.property_id in (select id from props)
      and p.received_at::date between p_from and p_to
    group by c.property_id
  ),
  outstanding as (
    select cb.property_id, sum(cb.balance_halalas)::bigint as bal
    from app.charge_balance cb
    where cb.property_id in (select id from props)
    group by cb.property_id
  )
  select
    pr.id,
    pr.name,
    coalesce(col.amt, 0),
    coalesce(o.bal, 0),
    round(coalesce(col.amt, 0) * (select p from pct))::bigint,
    (coalesce(col.amt, 0) - round(coalesce(col.amt, 0) * (select p from pct)))::bigint
  from props pr
  left join collected  col on col.property_id = pr.id
  left join outstanding o   on o.property_id  = pr.id
  order by pr.name;
$$;

revoke all on function app.owner_statement(uuid, date, date) from public;
grant execute on function app.owner_statement(uuid, date, date) to authenticated, service_role;
