-- 0053_service_role_only_grants.sql
-- SECURITY FIX. Found while writing the T-4 health tests, and older than that sprint.
--
-- 0001 declares:
--     alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;
--
-- so EVERY function in app is granted EXECUTE to anon and authenticated the moment it is created.
-- `revoke all on function ... from public` — which is what the webhook-only and cron-only functions
-- did — removes the implicit PUBLIC grant but leaves those two EXPLICIT role grants untouched. The
-- functions were therefore callable by any signed-in user.
--
-- For the gated functions this changed nothing: `is_platform_operator()`, `has_org_access()` and the
-- rest are checked INSIDE the function, and ADR-0006 says exactly that — the grant is not what
-- authorizes. But the service-role-only functions have no internal gate at all. The grant was the
-- whole defence, and it was not there.
--
-- The worst of them: app.apply_subscription_payment(intent, gateway_id, raw) marks a subscription
-- paid and rolls the period forward. A signed-in user who could read their own payment intent id —
-- it is in their own row — could call it and extend their subscription without paying. Confirmed
-- against PG17: the call executed and returned PAYMENT_INTENT_NOT_FOUND for a bogus id rather than
-- being refused. Same shape for the dunning, email-outbox, renewal-claim and card-token functions.
--
-- The default privilege declaration STAYS: the whole platform and app surface depends on
-- `authenticated` being able to reach gated functions. The rule this migration establishes is the
-- other half of it —
--
--     A FUNCTION WITH NO INTERNAL AUTHORIZATION CHECK MUST REVOKE FROM anon AND authenticated
--     EXPLICITLY. Revoking from PUBLIC is not enough in this schema.
--
-- Nothing about behaviour changes for the legitimate callers: every one of these is invoked by a
-- server route holding the service_role key, or from inside another SECURITY DEFINER function
-- (which executes as the owner and does not consult the caller's grants).

-- Read helpers: leak another org's counts to any signed-in caller. Their real callers are the
-- SECURITY DEFINER enforcement trigger and the summary/platform readers, so this is invisible to them.
revoke all on function app.subscription_active(uuid)  from public, anon, authenticated;
revoke all on function app.plan_limit(uuid, text)     from public, anon, authenticated;
revoke all on function app.usage_count(uuid, text)    from public, anon, authenticated;

-- Email outbox: leasing, and declaring a message sent that was never sent.
revoke all on function app.claim_email_deliveries(int)                   from public, anon, authenticated;
revoke all on function app.mark_email_delivery_sent(uuid, text, jsonb)   from public, anon, authenticated;
revoke all on function app.mark_email_delivery_failed(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app.enqueue_notification_email(uuid)              from public, anon, authenticated;

-- Money. apply_subscription_payment is the one that mattered.
revoke all on function app.apply_subscription_payment(uuid, text, jsonb)     from public, anon, authenticated;
revoke all on function app.mark_subscription_payment_failed(uuid, jsonb)     from public, anon, authenticated;
revoke all on function app.save_payment_method(uuid, text, text, text, int, int) from public, anon, authenticated;
revoke all on function app.claim_due_renewals(int)                          from public, anon, authenticated;
revoke all on function app.record_dunning_failure(uuid, jsonb)              from public, anon, authenticated;

-- Re-assert the intended grant so re-running this file leaves the surface exactly as designed.
grant execute on function app.subscription_active(uuid)  to service_role;
grant execute on function app.plan_limit(uuid, text)     to service_role;
grant execute on function app.usage_count(uuid, text)    to service_role;
grant execute on function app.claim_email_deliveries(int)                   to service_role;
grant execute on function app.mark_email_delivery_sent(uuid, text, jsonb)   to service_role;
grant execute on function app.mark_email_delivery_failed(uuid, text, jsonb) to service_role;
grant execute on function app.enqueue_notification_email(uuid)              to service_role;
grant execute on function app.apply_subscription_payment(uuid, text, jsonb)     to service_role;
grant execute on function app.mark_subscription_payment_failed(uuid, jsonb)     to service_role;
grant execute on function app.save_payment_method(uuid, text, text, text, int, int) to service_role;
grant execute on function app.claim_due_renewals(int)                          to service_role;
grant execute on function app.record_dunning_failure(uuid, jsonb)              to service_role;
