-- 0085_close_owner_invite_door.sql
-- The second door into identity linking, closed. 0074 shut one and left its twin standing.
--
-- 0074 removed app.link_party_identity because holding a live invitation token was enough to bind
-- your login to a party — and replaced it with accept_portal_invitation, which additionally demands
-- that the signed-in account's contact match the contact the invitation was addressed to
-- (CONTACT_MISMATCH). That function was written for BOTH kinds; /portal/join calls it for everyone.
--
-- app.accept_owner_invitation (0028) was never touched. It is still SECURITY DEFINER, still granted
-- to `authenticated`, and still does this:
--
--   perform set_config('app.allow_party_link', 'on', true);
--   update app.party set identity_id = v_me where id = v_inv.party_id;
--
-- with no check on WHO is accepting beyond "this party is not already linked to someone else". It is
-- callable directly through PostgREST, not only from our UI. So an owner's invitation link that
-- reaches the wrong hands — a forwarded WhatsApp message, a shared inbox — links that account to the
-- owner's profile, and with it their statements, their remittances and their IBAN.
--
-- The same hole, in the same shape, one function along. Confirmed with the owner before dropping:
-- no owner is linked through the portal today, and existing links would be untouched regardless —
-- this removes a way to create NEW ones, not any that exist.
--
-- app.create_owner_invitation goes with it, and is not a loss: it inserts a fresh invitation without
-- retiring the live one, so 0075's `invitation_one_live_portal` index refuses the second click with
-- a raw duplicate-key error. The owners screen now uses resend_portal_invitation, which rotates —
-- the same machinery the tenant side has had since 0075.
--
-- Dropped, not revoked. 0074 made the same choice for the same reason: a function whose privileges
-- were merely narrowed is a function someone re-grants by accident, and one that no longer exists
-- fails loudly at the call site instead of quietly succeeding somewhere unexpected.

drop function if exists app.accept_owner_invitation(text);
drop function if exists app.create_owner_invitation(uuid);

select app.record_migration('0085', 'close_owner_invite_door');
