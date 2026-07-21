-- 03_modeling.sql — pgTAP. Contract immutability, derived financial status, no-float (§10 tests 11–13).
-- Run: supabase test db
begin;
select plan(9);

-- ---------- seed ----------
insert into app.organization(id,name) values ('10000000-0000-0000-0000-0000000000a1','Org M');
insert into app.party(id,org_id,display_name,roles) values ('10000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000a1','Self', array['owner']::app.party_role[]);
insert into app.owner(id,org_id,party_id,is_self) values ('10000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d1',true);
insert into app.property(id,org_id,owner_id,name) values ('10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000e1','P');
insert into app.unit(id,org_id,property_id,unit_number,current_status) values ('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','101','rented');
insert into app.party(id,org_id,display_name,roles) values ('10000000-0000-0000-0000-0000000000d2','10000000-0000-0000-0000-0000000000a1','Tenant', array['tenant']::app.party_role[]);
insert into app.tenant(id,org_id,party_id) values ('10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d2');
insert into app.contract(id,org_id,property_id,unit_id,tenant_id,contract_number,start_date,end_date,annual_rent_halalas,status)
  values ('10000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000012','CT-1', current_date-400, current_date+100, 12000000, 'active');

-- ============ Test 11: UPDATE on active contract rejected; lifecycle transition allowed ============
select throws_ok(
  $$update app.contract set annual_rent_halalas=99999999 where id='10000000-0000-0000-0000-000000000013'$$,
  null, null, 'T11: editing a financial field on an active contract is rejected');
select lives_ok(
  $$update app.contract set status='terminated', terminated_at=now() where id='10000000-0000-0000-0000-000000000013'$$,
  'T11: lifecycle transition (terminate) on active contract is allowed');
update app.contract set status='active', terminated_at=null where id='10000000-0000-0000-0000-000000000013';

-- ============ Test 12: derived financial status ============
insert into app.charge(id,org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas)
  values ('10000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000013','residential_rent', current_date-10, 1000000),
         ('10000000-0000-0000-0000-000000000022','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000013','residential_rent', current_date+30, 1000000);

-- partial payment (400,000 of 1,000,000) → balance 600,000, overdue, not settled
insert into app.payment(id,org_id,party_id,amount_halalas) values ('10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d2',400000);
insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000021',400000);
select results_eq(
  $$select balance_halalas, is_settled, is_overdue from app.charge_balance where charge_id='10000000-0000-0000-0000-000000000021'$$,
  $$values (600000::bigint, false, true)$$,
  'T12: partial+late → balance 600000, unsettled, overdue');

-- overpayment: allocation cannot exceed the charge gross
insert into app.payment(id,org_id,party_id,amount_halalas) values ('10000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d2',1500000);
insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000022',1000000);
select throws_ok(
  $$insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas)
    values('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000022',1)$$,
  null, null, 'T12: allocation cannot exceed charge gross (overpayment capped)');
select is((select unallocated_halalas from app.payment_status where payment_id='10000000-0000-0000-0000-000000000032')::bigint, 500000::bigint,
          'T12: overpayment leaves a 500000 on-account credit');
select is((select is_settled from app.charge_balance where charge_id='10000000-0000-0000-0000-000000000022'), true,
          'T12: charge fully settled by capped allocation');

-- one payment settles two charges
insert into app.charge(id,org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas) values
  ('10000000-0000-0000-0000-000000000023','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000013','service_fee', current_date, 600000),
  ('10000000-0000-0000-0000-000000000024','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000013','service_fee', current_date, 400000);
insert into app.payment(id,org_id,party_id,amount_halalas) values ('10000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000d2',1000000);
insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values
  ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000023',600000),
  ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000024',400000);
select is((select bool_and(is_settled) from app.charge_balance where charge_id in ('10000000-0000-0000-0000-000000000023','10000000-0000-0000-0000-000000000024')), true,
          'T12: one payment settles two charges');
select throws_ok(
  $$insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas)
    values('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000021',1)$$,
  null, null, 'T12: allocation cannot exceed the payment total');

-- ============ Test 13: no float anywhere in the financial (or any) app column ============
select is(
  (select count(*)::int from information_schema.columns
     where table_schema='app' and data_type in ('double precision','real')),
  0, 'T13: no float/double columns in the app schema');

select * from finish();
rollback;
