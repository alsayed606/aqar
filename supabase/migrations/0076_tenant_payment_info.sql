-- 0076_tenant_payment_info.sql
-- Where to send the money.
--
-- The tenant portal has always been able to say what is owed and when. It could not say how to pay
-- it: the office's bank details live on app.organization, and RLS — rightly — shows a tenant nothing
-- of that table. So the screen ended at "٩٬٠٠٠ ر.س، متأخرة ٣ أيام" and the tenant phoned to ask for
-- an IBAN that the office had already recorded.
--
-- Three fields and no more: the account name, the bank, and the IBAN. Not the CR number, not the VAT
-- number, not the address or the licence — a tenant paying rent needs none of them, and a portal
-- read is a read by someone outside the office.
create or replace function app.tenant_portal_payment_info(p_tenant uuid)
returns table (org_name text, bank_name text, iban text)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  -- Returns a row only when there is something to act on. A card headed "كيف أدفع" over three
  -- dashes is worse than no card: it tells the tenant the office forgot, in the office's voice.
  return query
    select o.name, o.bank_name, o.iban
    from app.tenant t
    join app.organization o on o.id = t.org_id
    where t.id = p_tenant
      and o.iban is not null
      and o.deleted_at is null;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` closes nothing. Revoke by name, then grant back deliberately.
revoke all on function app.tenant_portal_payment_info(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_payment_info(uuid) to authenticated;

select app.record_migration('0076', 'tenant_payment_info');
