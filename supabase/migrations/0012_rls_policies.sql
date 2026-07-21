-- 0012_rls_policies.sql
-- RLS enabled on EVERY table. Org-scoped tables gate on app.has_org_access(org_id); portfolio
-- tables add app.has_property_access(org_id, property_id). Auth-layer tables are self-only or
-- service-role-only. service_role bypasses RLS by design (trusted server code). SCHEMA.md §6.

-- ===========================================================================
-- Base privileges. RLS only filters rows the role is otherwise allowed to touch.
-- authenticated gets DML on data tables; RLS does the confinement. Hard DELETE is withheld
-- (soft-delete convention, §7 rule 6) except on link/staging tables where physical delete is valid.
-- ===========================================================================
grant select, insert, update on
  app.organization, app.feature_flag, app.membership, app.invitation,
  app.party, app.owner, app.tenant,
  app.property, app.building, app.unit, app.unit_status_history,
  app.contract, app.contract_amendment, app.management_agreement,
  app.charge, app.payment, app.payment_allocation,
  app.document, app.import_batch, app.import_row
to authenticated;

grant select, insert, update, delete on
  app.membership_property_scope, app.management_agreement_unit, app.payment_allocation
to authenticated;

grant select on app.identity, app.auth_method, app.session to authenticated;
grant update on app.identity to authenticated;
grant select, insert on app.audit_log to authenticated;

-- ===========================================================================
-- Enable RLS everywhere.
-- ===========================================================================
alter table app.identity                    enable row level security;
alter table app.auth_method                  enable row level security;
alter table app.session                      enable row level security;
alter table app.otp_challenge                enable row level security;
alter table app.auth_attempt                 enable row level security;
alter table app.sms_outbox                   enable row level security;
alter table app.organization                 enable row level security;
alter table app.feature_flag                 enable row level security;
alter table app.membership                   enable row level security;
alter table app.membership_property_scope    enable row level security;
alter table app.invitation                   enable row level security;
alter table app.party                        enable row level security;
alter table app.owner                        enable row level security;
alter table app.tenant                       enable row level security;
alter table app.property                     enable row level security;
alter table app.building                     enable row level security;
alter table app.unit                         enable row level security;
alter table app.unit_status_history          enable row level security;
alter table app.contract                     enable row level security;
alter table app.contract_amendment           enable row level security;
alter table app.management_agreement         enable row level security;
alter table app.management_agreement_unit    enable row level security;
alter table app.charge                       enable row level security;
alter table app.payment                      enable row level security;
alter table app.payment_allocation           enable row level security;
alter table app.document                     enable row level security;
alter table app.audit_log                    enable row level security;
alter table app.import_batch                 enable row level security;
alter table app.import_row                   enable row level security;

-- ===========================================================================
-- Auth layer — self-only. otp_challenge / auth_attempt / sms_outbox: NO authenticated policy
-- (RLS enabled + no policy = deny); only service_role (bypassrls) touches them.
-- ===========================================================================
create policy identity_self_select on app.identity for select using (id = auth.uid());
create policy identity_self_update on app.identity for update using (id = auth.uid()) with check (id = auth.uid());

create policy auth_method_self on app.auth_method for select using (identity_id = auth.uid());
create policy session_self      on app.session     for select using (identity_id = auth.uid());

-- ===========================================================================
-- Organization — visible to its live members; updatable by admins. Creation is a SECURITY DEFINER
-- RPC (0013) run under service role, so no INSERT policy for authenticated.
-- ===========================================================================
create policy organization_select on app.organization for select using (app.has_org_access(id));
create policy organization_update on app.organization for update using (app.is_org_admin(id)) with check (app.is_org_admin(id));

-- ===========================================================================
-- Feature flags — read by members, written by admins.
-- ===========================================================================
create policy feature_flag_select on app.feature_flag for select using (app.has_org_access(org_id));
create policy feature_flag_write  on app.feature_flag for all
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

-- ===========================================================================
-- Membership — self rows always visible; admins see all org rows. Writes: admins only.
-- has_org_access / is_org_admin are SECURITY DEFINER so this policy does NOT recurse. §6
-- ===========================================================================
create policy membership_select on app.membership for select
  using (identity_id = auth.uid() or app.has_org_access(org_id));
create policy membership_insert on app.membership for insert
  with check (app.is_org_admin(org_id));
create policy membership_update on app.membership for update
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

create policy membership_scope_select on app.membership_property_scope for select
  using (exists (select 1 from app.membership m where m.id = membership_id and app.has_org_access(m.org_id)));
create policy membership_scope_write on app.membership_property_scope for all
  using (exists (select 1 from app.membership m where m.id = membership_id and app.is_org_admin(m.org_id)))
  with check (exists (select 1 from app.membership m where m.id = membership_id and app.is_org_admin(m.org_id)));

-- ===========================================================================
-- Invitation — admins manage. (Acceptance is a SECURITY DEFINER RPC, 0013.)
-- ===========================================================================
create policy invitation_select on app.invitation for select using (app.has_org_access(org_id));
create policy invitation_write  on app.invitation for all
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

-- ===========================================================================
-- Parties & role branches — any active member of the org.
-- ===========================================================================
create policy party_all  on app.party  for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy owner_all  on app.owner  for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy tenant_all on app.tenant for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- ===========================================================================
-- Portfolio tables — org gate + property scope. §6 second layer, §10 test 4.
-- ===========================================================================
create policy property_all on app.property for all
  using (app.has_property_access(org_id, id))
  with check (app.has_property_access(org_id, id));

create policy building_all on app.building for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy unit_all on app.unit for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy unit_status_history_all on app.unit_status_history for all
  using (exists (select 1 from app.unit u where u.id = unit_id and app.has_property_access(u.org_id, u.property_id)))
  with check (exists (select 1 from app.unit u where u.id = unit_id and app.has_property_access(u.org_id, u.property_id)));

create policy contract_all on app.contract for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy contract_amendment_all on app.contract_amendment for all
  using (exists (select 1 from app.contract c where c.id = contract_id and app.has_property_access(c.org_id, c.property_id)))
  with check (exists (select 1 from app.contract c where c.id = contract_id and app.has_property_access(c.org_id, c.property_id)));

-- Management agreements can be property-level or unit-level (property_id NULL) → org gate covers NULL.
create policy management_agreement_all on app.management_agreement for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy management_agreement_unit_all on app.management_agreement_unit for all
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_org_access(a.org_id)))
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_org_access(a.org_id)));

-- ===========================================================================
-- Financials — charge is property-scoped; payment/allocation are org-scoped (accountant view).
-- ===========================================================================
create policy charge_all on app.charge for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy payment_all on app.payment for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

create policy payment_allocation_all on app.payment_allocation for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- ===========================================================================
-- Documents — org gate + property scope when property_id is set (NULL → org-level).
-- ===========================================================================
create policy document_all on app.document for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- ===========================================================================
-- Audit log — members read their org's log; anyone active can append. UPDATE/DELETE blocked by
-- trigger (0013), so no update/delete policy exists. §8
-- ===========================================================================
create policy audit_log_select on app.audit_log for select using (org_id is not null and app.has_org_access(org_id));
create policy audit_log_insert on app.audit_log for insert with check (org_id is null or app.has_org_access(org_id));

-- ===========================================================================
-- Import staging — org-scoped.
-- ===========================================================================
create policy import_batch_all on app.import_batch for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy import_row_all on app.import_row for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
