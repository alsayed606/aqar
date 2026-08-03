-- 0060_rate_limit.sql
-- Launch sprint: throttling for the auth surface.
--
-- Why in the database and not in memory: the app runs on Vercel's serverless functions. An in-memory
-- counter lives inside one instance, so an attacker spreading requests across concurrent invocations
-- gets a fresh allowance each time — the limiter would measure nothing. A row in Postgres is the one
-- piece of state every instance already shares.
--
-- The whole decision is a single atomic upsert. Read-then-write would let two concurrent attempts
-- both read `hits = limit - 1` and both be allowed; there is no lock here because there is no gap.

create table if not exists app.rate_limit (
  -- Caller-supplied and already hashed (see lib/rate-limit.ts): this table must never accumulate
  -- raw e-mail addresses or phone numbers, both because it is unbounded attacker-controlled input
  -- and because PDPL has no reason to see personal data in a throttling counter.
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists rate_limit_updated_idx on app.rate_limit (updated_at);

-- RLS on with NO policy, the same pattern the platform tables use: nothing reaches this table except
-- through the SECURITY DEFINER function below, which only service_role may call.
alter table app.rate_limit enable row level security;

-- ---------------------------------------------------------------------------
-- Count one attempt and say whether it is allowed.
-- `allowed` is false on the attempt that exceeds the limit, not the one that reaches it.
-- ---------------------------------------------------------------------------
create or replace function app.rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int)
returns table (allowed boolean, remaining int, retry_after int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_now    timestamptz := now();
  v_expiry interval    := make_interval(secs => greatest(p_window_seconds, 1));
  v_start  timestamptz;
  v_hits   int;
begin
  insert into app.rate_limit as rl (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
     -- An expired window restarts at 1 rather than being deleted and re-inserted, which would race.
     set hits         = case when rl.window_start < v_now - v_expiry then 1 else rl.hits + 1 end,
         window_start = case when rl.window_start < v_now - v_expiry then v_now else rl.window_start end,
         updated_at   = v_now
  returning rl.window_start, rl.hits into v_start, v_hits;

  return query select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    greatest(ceil(extract(epoch from (v_start + v_expiry) - v_now))::int, 0);
end;
$$;

-- Housekeeping: buckets older than a day are dead weight. Called from the daily cron.
create or replace function app.rate_limit_sweep() returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_deleted int;
begin
  delete from app.rate_limit where updated_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default, so `revoke from public` alone
-- would leave these open. A signed-out caller reaching rate_limit_hit could burn another account's
-- allowance at will, which turns the defence into the attack.
revoke all on function app.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke all on function app.rate_limit_sweep()             from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, int, int) to service_role;
grant execute on function app.rate_limit_sweep()             to service_role;
