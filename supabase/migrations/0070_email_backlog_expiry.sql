-- 0070_email_backlog_expiry.sql
-- حدّ عُمر داخل طابور البريد: الرسالة المتأخّرة كثيراً لا تُرسَل، تُشطب.
--
-- WHY
-- `claim_email_deliveries` (0038) took every pending row, oldest first, with no notion of age. That
-- is right when the drain runs every few minutes and wrong the moment it stops: on 8 Aug 2026 three
-- environment variables turned out to have been wrong since launch, so the drain had NEVER run, and
-- the first successful cron would have begun mailing offices reminders about instalments they paid
-- months ago and contracts that have since been renewed. Correct the day they were written; wrong
-- by the time they arrived.
--
-- **A queue that comes back after an outage must not flood the customer with the past.**
--
-- WHY EXPIRE RATHER THAN SKIP
-- Filtering the stale rows out of the claim alone would leave them `pending` for ever: the drain
-- would ignore them, and the "بريد بانتظار الإرسال" gauge on /platform/health would keep counting
-- deliveries that are never going to happen. A number nobody can act on is worse than no number.
-- So the claim expires them explicitly, and the queue depth goes back to meaning what it says.
--
-- WHAT IS AND IS NOT LOST
-- Only the DELIVERY is abandoned. The notification itself stays in app.notification and the office
-- still sees it in the app — this drops the e-mail about it, not the fact.

-- ---------------------------------------------------------------------------
-- claim_email_deliveries — same contract, two changes: stale rows are retired first, and the claim
-- itself will not pick up anything older than the window.
-- ---------------------------------------------------------------------------
create or replace function app.claim_email_deliveries(p_max int default 25)
returns setof app.notification_delivery
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  -- Seven days. A due-date reminder is worth sending late; it is not worth sending a week late, and
  -- past that the office has either paid or chased it themselves. Deliberately a constant and not a
  -- parameter: there is no second caller who would pass a different number, and a knob nobody turns
  -- is a knob that goes stale.
  v_max_age constant interval := interval '7 days';
begin
  -- Retire first, so the same run that refuses to send them also stops them being counted as owed.
  update app.notification_delivery
     set status = 'failed',
         last_error = 'expired: older than 7 days when the queue was drained'
   where channel = 'email'
     and status = 'pending'
     and created_at < now() - v_max_age;

  return query
  update app.notification_delivery d
     set attempts        = d.attempts + 1,
         last_attempt_at  = now(),
         next_attempt_at  = now() + (case d.attempts + 1
                                       when 1 then interval '1 minute'
                                       when 2 then interval '5 minutes'
                                       else        interval '30 minutes'
                                     end)
   where d.id in (
     select c.id from app.notification_delivery c
     where c.channel = 'email' and c.status = 'pending'
       and c.next_attempt_at <= now() and c.attempts < c.max_attempts
       -- Belt and braces with the expiry above: a row that crosses the line between the two
       -- statements in a long-running drain must not slip through.
       and c.created_at >= now() - v_max_age
     order by c.created_at
     for update skip locked
     limit greatest(p_max, 0)
   )
  returning d.*;
end;
$$;

-- Grants re-stated: `create or replace` keeps the old ones, but 0053's lesson is that a function's
-- reachability should be readable in the migration that last touched it rather than three files back.
revoke all on function app.claim_email_deliveries(int) from public, anon, authenticated;
grant execute on function app.claim_email_deliveries(int) to service_role;

select app.record_migration('0070', '0070_email_backlog_expiry');
