-- 0035_search_indexes.sql
-- Sprint C / C-1: keep substring search (ilike '%q%') on the list pages fast as records grow, via
-- trigram GIN indexes on the searched text columns. Idempotent; safe on live + fresh DB.
create extension if not exists pg_trgm with schema extensions;

create index if not exists property_name_trgm    on app.property using gin (name            extensions.gin_trgm_ops);
create index if not exists party_display_trgm     on app.party    using gin (display_name    extensions.gin_trgm_ops);
create index if not exists contract_number_trgm   on app.contract using gin (contract_number extensions.gin_trgm_ops);
create index if not exists invoice_no_trgm        on app.invoice  using gin (invoice_no      extensions.gin_trgm_ops);
create index if not exists payment_receipt_trgm   on app.payment  using gin (receipt_no      extensions.gin_trgm_ops);
