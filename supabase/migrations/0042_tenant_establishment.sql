-- 0042_tenant_establishment.sql
-- Sprint J: richer tenant / commercial-establishment modelling. Purely ADDITIVE and backward
-- compatible — every column is nullable or defaulted, existing rows/contracts are untouched, no data
-- is lost, and no policy changes (party/tenant/contract already carry the 0041 capability policies).
--
-- Design choices that preserve the current architecture:
--   * tenant type is a TEXT + CHECK column (individual / sole_establishment / company), NOT a new
--     value on the app.legal_kind enum — `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
--     block (would break the SQL-Editor/one-shot apply), and a checked text column is just as safe
--     while leaving legal_kind (and the existing tenant_kind) intact for backward compatibility.
--   * establishment identifiers live on app.party (the entity), beside the existing cr_number.
--   * the TRADE/SHOP name and the signing REPRESENTATIVE live on app.contract, so one establishment
--     (party) can hold several contracts, each with its own shop name (شركة الراجحي → مخابز الريان،
--     سوبر ماركت الريان، …). New contract columns are outside the tg_contract_immutable frozen set,
--     so they stay editable (e.g. fixing a typo) without touching the immutability guard.

-- Establishment identifiers on the party (cr_number already exists).
alter table app.party add column if not exists vat_number     text;  -- الرقم الضريبي
alter table app.party add column if not exists unified_number text;  -- الرقم الموحّد (700)
alter table app.party add column if not exists cr_expiry      date;  -- تاريخ انتهاء السجل التجاري

-- Tenant legal form. Backfilled from the existing tenant_kind so current rows keep their meaning.
alter table app.tenant
  add column if not exists tenant_type text not null default 'individual'
    check (tenant_type in ('individual', 'sole_establishment', 'company'));
update app.tenant set tenant_type = 'company' where tenant_kind = 'company' and tenant_type = 'individual';

-- Trade/shop name + signing representative, per contract.
alter table app.contract add column if not exists trade_name             text;  -- اسم المحل التجاري
alter table app.contract add column if not exists representative_name     text;  -- اسم ممثل المنشأة
alter table app.contract add column if not exists representative_capacity text;  -- صفته
alter table app.contract add column if not exists representative_id       text;  -- رقم هويته (اختياري)
alter table app.contract add column if not exists representative_phone    text;  -- جواله (اختياري)
