-- 0030_portal_documents.sql
-- Data for self-service PRINTABLE documents in the portals. The owner statement + remittance voucher
-- already have everything they need from the 0028 portal functions, so they need no new data here;
-- this migration adds only what the tenant RECEIPT needs (payment detail + its allocation lines) and
-- the org header (name/CR/VAT) for the owner's printable statement/voucher. All SECURITY DEFINER,
-- all gated on ownership by login identity (same pattern as 0028/0029).

-- Full receipt header for one of the tenant's own payments.
create or replace function app.tenant_portal_receipt(p_tenant uuid, p_payment uuid)
returns table (receipt_no text, amount_halalas bigint, method app.payment_method, received_at timestamptz,
               reference text, notes text, payer_name text, payer_id text,
               org_name text, org_cr text, org_vat text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pay.receipt_no, pay.amount_halalas, pay.method, pay.received_at, pay.reference, pay.notes,
           pp.display_name, coalesce(pp.national_id, pp.iqama_id, pp.cr_number),
           org.name, org.cr_number, org.vat_number
    from app.payment pay
    join app.tenant t on t.id = p_tenant
    join app.party pp on pp.id = t.party_id
    join app.organization org on org.id = pay.org_id
    where pay.id = p_payment and pay.party_id = t.party_id and pay.deleted_at is null;
end;
$$;

-- What that payment settled (its allocations).
create or replace function app.tenant_portal_receipt_lines(p_tenant uuid, p_payment uuid)
returns table (description text, amount_halalas bigint, contract_number text, unit_number text, property_name text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select ch.description, a.amount_halalas, c.contract_number, u.unit_number, pr.name
    from app.payment_allocation a
    join app.payment pay on pay.id = a.payment_id
    join app.tenant t on t.id = p_tenant
    join app.charge ch on ch.id = a.charge_id
    left join app.contract c on c.id = ch.contract_id
    left join app.unit u on u.id = ch.unit_id
    left join app.property pr on pr.id = ch.property_id
    where a.payment_id = p_payment and pay.party_id = t.party_id and pay.deleted_at is null;
end;
$$;

-- Office identity for the owner's printable statement/voucher header.
create or replace function app.owner_portal_org(p_owner uuid)
returns table (org_name text, org_cr text, org_vat text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select org.name, org.cr_number, org.vat_number
    from app.owner o join app.organization org on org.id = o.org_id where o.id = p_owner;
end;
$$;

grant execute on function app.tenant_portal_receipt(uuid, uuid),
                         app.tenant_portal_receipt_lines(uuid, uuid),
                         app.owner_portal_org(uuid)
  to authenticated, service_role;
