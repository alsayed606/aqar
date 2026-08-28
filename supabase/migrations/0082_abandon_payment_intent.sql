-- 0082_abandon_payment_intent.sql
-- Closing the payment intent that never reached the gateway.
--
-- startSubscriptionCheckout records an intent, then asks Moyasar for a hosted invoice. When that
-- second call fails — the gateway is down, the key is wrong — the office is told to try later and the
-- intent stays 'initiated' forever. Nobody can clear it: subscription_payment grants SELECT only, and
-- mark_subscription_payment_failed is service_role. So the money table accumulates rows for payments
-- that were never asked for, and /platform/billing reads them as customers stuck mid-checkout.
--
-- The third orphan of the same family in one week (the maintenance photo, the import batch, this).
-- Each time the rule was the same: whatever creates a row before the step that can fail owns the
-- cleanup, and the actor who created it must be allowed to undo it.

-- 'abandoned' rather than reusing 'failed'. A failed payment is a card that was declined — it belongs
-- in dunning, it is a fact about the customer. This is a fact about us: we never managed to ask.
-- Collapsing the two would put our outage into the office's payment history.
alter type app.subscription_payment_status add value if not exists 'abandoned';

-- ---------------------------------------------------------------------------
-- abandon_subscription_payment(intent)
-- ---------------------------------------------------------------------------
create or replace function app.abandon_subscription_payment(p_intent uuid)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org    uuid;
  v_status app.subscription_payment_status;
begin
  select org_id, status into v_org, v_status
    from app.subscription_payment where id = p_intent for update;

  -- Absence is not an error: the caller is cleaning up after a failure and may be racing a webhook
  -- that already resolved the same intent.
  if v_org is null then
    return false;
  end if;

  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  -- ONLY an intent that never left. 'paid' is money that moved, 'failed' is a decline the dunning
  -- schedule is built on, 'refunded' is settled history — none of them may be overwritten by a
  -- cleanup path, and a webhook arriving a second later must still find what it expects.
  if v_status <> 'initiated' then
    return false;
  end if;

  update app.subscription_payment
     set status = 'abandoned', updated_at = now()
   where id = p_intent and status = 'initiated';

  perform app.write_audit(v_org, 'subscription.payment_abandoned', 'subscription_payment', p_intent,
                          jsonb_build_object('reason', 'gateway_invoice_failed'));
  return true;
end;
$$;

-- 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public` closes
-- nothing. Revoke by name, then grant back deliberately.
revoke all on function app.abandon_subscription_payment(uuid) from public, anon, authenticated;
grant execute on function app.abandon_subscription_payment(uuid) to authenticated, service_role;

select app.record_migration('0082', 'abandon_payment_intent');
