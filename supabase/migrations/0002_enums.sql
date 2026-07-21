-- 0002_enums.sql
-- All domain enums live in the app schema. Enums are used only for stable, closed vocabularies.
-- NOTE: org_type is intentionally an enum used for *presentation/config only*. No data-layer
-- branch (RLS policy, trigger, constraint) may read it. See SCHEMA.md §2.

create type app.org_type          as enum ('management_office', 'brokerage', 'owner');

create type app.membership_role    as enum ('owner', 'admin', 'manager', 'accountant', 'staff', 'viewer');
create type app.membership_status  as enum ('invited', 'active', 'suspended', 'revoked');

create type app.auth_method_type   as enum ('phone_otp', 'passkey', 'email', 'sso');

create type app.party_role         as enum ('owner', 'tenant', 'vendor', 'broker');
create type app.legal_kind         as enum ('individual', 'company');

create type app.property_kind      as enum ('residential', 'commercial', 'mixed_use', 'land', 'other');

-- Explicit operational state of a unit. Occupancy over time is computed from UnitStatusHistory,
-- never from this "current" value alone. See SCHEMA.md §7 rule 10.
create type app.unit_status        as enum (
  'vacant',            -- شاغرة
  'rented',            -- مؤجرة
  'reserved',          -- محجوزة
  'under_maintenance', -- تحت الصيانة
  'not_rentable',      -- غير صالحة للتأجير
  'out_of_service'     -- خارج الخدمة
);

create type app.contract_status    as enum ('draft', 'active', 'expired', 'terminated', 'cancelled');
create type app.contract_kind      as enum ('residential', 'commercial');
create type app.payment_frequency  as enum ('monthly', 'quarterly', 'semi_annual', 'annual', 'one_time', 'custom');

-- Charge classification drives VAT treatment; adding it later would mean back-filling history
-- we do not have. See SCHEMA.md §7 rule 2.
create type app.charge_type        as enum (
  'residential_rent',  -- إيجار سكني  (VAT-exempt in KSA)
  'commercial_rent',   -- إيجار تجاري (VAT 15%)
  'service_fee',       -- خدمات
  'insurance',         -- تأمين
  'admin_fee',         -- رسوم إدارية
  'security_deposit'   -- تأمين مسترد (out of VAT scope)
);

create type app.payment_method     as enum ('cash', 'bank_transfer', 'sadad', 'mada', 'apple_pay', 'card', 'cheque', 'other');

create type app.fee_model          as enum ('percentage_of_collection', 'fixed_amount', 'per_unit');

create type app.document_entity    as enum (
  'organization', 'property', 'unit', 'contract', 'management_agreement',
  'owner', 'tenant', 'payment', 'charge'
);

create type app.import_kind        as enum ('properties', 'units', 'owners', 'tenants', 'contracts', 'charges');
create type app.import_status      as enum ('draft', 'validated', 'committed', 'reverted', 'failed');
