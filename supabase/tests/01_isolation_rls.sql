-- 01_isolation_rls.sql — pgTAP. Multi-tenant isolation + property scope (§10 tests 1–5).
-- Run: supabase test db   (requires `create extension pgtap;`)
begin;
select plan(11);

-- ---------- seed as the migration/superuser role (RLS bypassed) ----------
insert into app.organization(id, name) values
  ('00000000-0000-0000-0000-0000000000a1','Office One'),
  ('00000000-0000-0000-0000-0000000000a2','Office Two');

insert into app.identity(id, phone_e164) values
  ('00000000-0000-0000-0000-0000000000b1','+966500000001'),  -- A: owner org1
  ('00000000-0000-0000-0000-0000000000b2','+966500000002'),  -- B: owner org2
  ('00000000-0000-0000-0000-0000000000b3','+966500000003'),  -- C: member of both
  ('00000000-0000-0000-0000-0000000000b4','+966500000004');  -- S: scoped staff org1

insert into app.membership(id, identity_id, org_id, role, status, scope_all) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','owner','active',true),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','owner','active',true),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a1','manager','active',true),
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a2','manager','active',true),
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000a1','staff','active',false);

insert into app.party(id, org_id, display_name, roles) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','Self One', array['owner']::app.party_role[]),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a2','Self Two', array['owner']::app.party_role[]);
insert into app.owner(id, org_id, party_id, is_self) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1',true),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000d2',true);

insert into app.property(id, org_id, owner_id, name) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','P1-Riyadh'),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','P2-Jeddah'),
  ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','P3-Dammam');
insert into app.membership_property_scope(membership_id, property_id)
  values ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000f1');  -- S scoped to P1

grant usage on schema app, extensions to authenticated;

-- convenience: switch identity + active org for the current transaction
create function pg_temp.login(p_sub uuid, p_org uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true);
  perform set_config('request.headers',   json_build_object('x-active-org',p_org)::text, true);
end $$;

-- ============ Test 1: multi-org isolation ============
select pg_temp.login('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.property), 2, 'T1: member sees only org1 (2) rows under org1 context');
select is((select count(*)::int from app.property where name='P3-Dammam'), 0, 'T1: org2 data does not leak into org1 view');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from app.property), 1, 'T1: same member sees only org2 (1) row under org2 context');
reset role;

-- ============ Test 3: forged org_id (non-member) ============
select pg_temp.login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a2');  -- A claims org2
set local role authenticated;
select is((select count(*)::int from app.property), 0, 'T3: forged active-org (non-member) yields zero rows');
select throws_ok(
  $$insert into app.property(org_id,owner_id,name)
    values('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','HACK')$$,
  null, null, 'T3: forged active-org write is rejected by RLS');
reset role;

-- ============ Test 4: property scope ============
select pg_temp.login('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000a1');  -- S
set local role authenticated;
select is((select count(*)::int from app.property), 1, 'T4: scoped staff sees only in-scope property');
select is((select count(*)::int from app.property where name='P2-Jeddah'), 0, 'T4: scoped staff cannot see out-of-scope property');
reset role;

-- ============ Test 5: cross-org / cross-scope R/W all fail ============
select pg_temp.login('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a1');  -- C in org1
set local role authenticated;
select is((select count(*)::int from app.property where id='00000000-0000-0000-0000-0000000000f3'), 0,
          'T5: cannot read another org row by id under wrong context');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000a1');  -- S
set local role authenticated;
select throws_ok(
  $$insert into app.unit(org_id,property_id,unit_number)
    values('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f2','X')$$,
  null, null, 'T5: cannot insert unit into out-of-scope property');
-- RLS silently filters the out-of-scope row → the UPDATE matches nothing and the row is untouched.
update app.property set city='HACK' where id='00000000-0000-0000-0000-0000000000f2';
reset role;
select is((select city from app.property where id='00000000-0000-0000-0000-0000000000f2'), null::text,
          'T5: cross-scope update modified nothing');

-- ============ Test 2: revoked membership loses access immediately ============
update app.membership set status='revoked' where id='00000000-0000-0000-0000-0000000000c3';  -- revoke C in org1
select pg_temp.login('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.property), 0, 'T2: revoked membership immediately loses read access (no token wait)');
reset role;

select * from finish();
rollback;
