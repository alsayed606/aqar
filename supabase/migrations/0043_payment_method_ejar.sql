-- 0043_payment_method_ejar.sql
-- Sprint K: add the Ejar platform as a payment method. PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE
-- inside a transaction block (the new value just can't be USED in the same transaction) — this
-- migration only ADDs it, so it is safe for the one-shot SQL-Editor apply and the test harness.
-- IF NOT EXISTS makes it idempotent. Existing payment rows are untouched.
alter type app.payment_method add value if not exists 'ejar';
