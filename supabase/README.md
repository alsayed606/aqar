# Data Layer — Phase 1 (System of Record)

Backend-only deliverable for the Saudi property-management SaaS. **No UI / app code** — awaiting approval.
Full design + rationale + Deferred Decisions: [`../SCHEMA.md`](../SCHEMA.md).

## Layout
- `migrations/` — 16 ordered SQL migrations (schema, RLS, `SECURITY DEFINER` helpers, triggers, auth/OTP, financial views, Excel import).
- `tests/` — pgTAP suites for the 13 mandatory tests (`supabase test db`).
- `tests/local/` — a runnable Node harness (embedded PostgreSQL 17) that needs neither Supabase nor pgTAP.
- `functions/import-excel/` — Deno Edge Function; thin transport over the SQL import pipeline.
- `templates/` — Arabic `.xlsx` import templates + their generator.

## Apply migrations
```bash
# Supabase project
supabase db reset            # runs migrations/ in order
# or plain psql
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## Run the tests
```bash
# Idiomatic pgTAP (needs: create extension pgtap;)
supabase test db

# Or the self-contained local harness (no Supabase, no pgTAP)
cd tests/local && npm install && npm run verify     # -> 36 passed, 0 failed
```

## Required runtime configuration
- **Active-org context (never in the JWT):** forward the `x-active-org` header from the app layer, or set `pgrst.db_pre_request` to a function that sets `app.current_org_id`. RLS proves it against live membership on every query.
- **OTP pepper:** `ALTER DATABASE <db> SET app.otp_pepper = '<secret>';` (do not keep the dev default).
- **SMS provider:** drain `app.sms_outbox` from your provider adapter (Unifonic/Taqnyat/fallback) and delete rows after send (`purge_after`).

## Verified against PostgreSQL 17
All 16 migrations load clean; 36/36 behavioural checks and 3/3 pgTAP files pass (multi-tenant isolation,
property scope, immediate revocation, forged-org rejection, no Party↔Identity auto-link, contract
immutability, derived financials incl. partial/late/over-payment, OTP single-use/expiry/rate-limit/
enumeration-safety, no-float, and the Excel validate→commit→revert round-trip).
