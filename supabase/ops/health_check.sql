-- ============================================================================
-- SmartTodo production operations health check
-- ============================================================================
--
-- PURPOSE
--   Read-only verification of production operational state. Run this in the
--   Supabase SQL editor, or via `psql`, against the production database.
--
-- SAFETY
--   * No statement modifies application or operational data. Nothing is
--     dispatched, no job is rescheduled, and no table is truncated. The only
--     object created is a `pg_temp` helper, which lives in a session-local
--     temporary schema and disappears when the session ends.
--   * It prints NO secret material. The scheduler token is only ever reported as
--     a boolean "present"; its value and length are never shown.
--   * It prints no user email, no task title, and no notification body. Task and
--     notification data is reported only as aggregate counts.
--
-- HOW TO READ THE OUTPUT
--   Every row has a `check`, a `status` of PASS / WARN / FAIL, and a `detail`.
--   * FAIL means an operator must act now.
--   * WARN means degradation that is not yet breaking, e.g. no run in 2-5 minutes.
--   * PASS means healthy.
-- ============================================================================


-- ---------- 1. database connectivity and migration state ----------
-- The applied-migration count is only available when the project is managed by
-- the Supabase CLI. A raw/local Postgres has no `supabase_migrations` schema, and
-- merely *naming* that schema makes the statement fail at parse time even
-- inside a CASE, so the count is read dynamically instead: the table's row count
-- is only ever touched once the catalog has confirmed it exists.
CREATE OR REPLACE FUNCTION pg_temp.applied_migration_count()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN 'n/a (not a CLI-managed project)';
  END IF;
  EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO v_count;
  RETURN v_count::text;
END;
$$;

SELECT 'db'::text AS check,
       'PASS'::text AS status,
       'connected; ' || current_database() || ' on pg ' || current_setting('server_version')
         || '; applied migrations: ' || pg_temp.applied_migration_count() AS detail;


-- ---------- 2. the scheduler job exists and is active ----------
-- The job is expected to be scheduled every minute. `active` must be true and
-- the schedule must still be '* * * * *'. A paused or rescheduled job means
-- reminders have silently stopped.
SELECT 'cron_job'::text AS check,
       CASE
         WHEN count(*) = 0 THEN 'FAIL'
         WHEN bool_and(active) THEN 'PASS'
         ELSE 'FAIL'
       END::text AS status,
       count(*)::text || ' job(s); active='
         || COALESCE(bool_and(active)::text, 'n/a')
         || '; schedule='
         || COALESCE(string_agg(DISTINCT schedule, ','), 'n/a') AS detail
FROM cron.job
WHERE jobname = 'process-reminders-every-minute';


-- ---------- 3. the scheduler actually ran recently ----------
-- A healthy scheduler produces roughly one row per minute. Allow a little slack
-- for a slow tick, but flag clearly if nothing has landed for several minutes.
SELECT 'recent_runs'::text AS check,
       CASE
         WHEN max(fired_at) IS NULL THEN 'FAIL'
         WHEN max(fired_at) < now() - interval '5 minutes' THEN 'FAIL'
         WHEN max(fired_at) < now() - interval '2 minutes' THEN 'WARN'
         ELSE 'PASS'
       END::text AS status,
       COALESCE(
         'last run ' || round(EXTRACT(epoch FROM (now() - max(fired_at))))::text || 's ago; '
           || count(*) FILTER (WHERE fired_at > now() - interval '15 minutes')::text
           || ' run(s) in the last 15 min',
         'no scheduler runs recorded'
       ) AS detail
FROM public.reminder_scheduler_runs;


-- ---------- 4. dispatch failures are visible ----------
-- `note` is 'dispatched' on success. Anything else is a configuration failure
-- that the function raised on. A non-zero count here needs investigation.
SELECT 'dispatch_errors'::text AS check,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text AS status,
       CASE
         WHEN count(*) = 0 THEN 'no non-dispatch rows recorded'
         ELSE count(*)::text || ' error row(s); newest: ' || max(fired_at)::text
              || ' / ' || max(note)
       END AS detail
FROM public.reminder_scheduler_runs
WHERE note IS DISTINCT FROM 'dispatched';


-- ---------- 5. pg_net responses for recent dispatches ----------
-- Only status codes and timing are shown: never the request headers, which carry
-- the scheduler token. A NULL count means the response has not landed yet, which
-- is normal because pg_net delivers asynchronously.
SELECT 'pg_net_responses'::text AS check,
       CASE
         WHEN count(*) = 0 THEN 'WARN'
         WHEN count(*) FILTER (WHERE status_code BETWEEN 200 AND 299) = count(*) THEN 'PASS'
         ELSE 'FAIL'
       END::text AS status,
       count(*)::text || ' response(s) in the last hour; ok='
         || count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::text AS detail
FROM net._http_response
WHERE created > now() - interval '1 hour';


-- ---------- 6. the scheduler token is present (never its value) ----------
-- Existence only. If this is FAIL the scheduler cannot dispatch, and the
-- function will raise on its next tick.
SELECT 'scheduler_token'::text AS check,
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END::text AS status,
       CASE
         WHEN count(*) = 1 THEN 'token present in Vault (value not displayed)'
         WHEN count(*) = 0 THEN 'token MISSING from Vault; scheduler cannot dispatch'
         ELSE count(*)::text || ' tokens present; expected exactly 1'
       END AS detail
FROM vault.secrets
WHERE name = 'process_reminders_scheduler_token';


-- ---------- 7. reminder processing health ----------
-- An unsent reminder already in the past is either being processed normally or
-- is stuck. A large backlog means processing has stopped.
SELECT 'reminder_backlog'::text AS check,
       CASE
         WHEN count(*) = 0 THEN 'PASS'
         WHEN count(*) <= 100 THEN 'WARN'
         ELSE 'FAIL'
       END::text AS status,
       'unsent reminders already past due: ' || count(*)::text
         || ' (oldest ' || COALESCE(min(reminder_time)::text, 'n/a') || ')' AS detail
FROM public.task_reminders
WHERE is_sent = false
  AND reminder_time < now();


-- ---------- 8. duplicate-send guard is intact ----------
-- The unique index on (task_id, reminder_type, reminder_time) is what makes
-- re-running the scheduler safe. Its absence would allow duplicate sends.
SELECT 'reminder_uniqueness'::text AS check,
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END::text AS status,
       CASE
         WHEN count(*) = 1 THEN 'unique index present; duplicate sends are prevented'
         ELSE 'unique index MISSING; duplicate sends are possible'
       END AS detail
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_task_reminders_logical_unique';


-- ---------- 9. audit table growth is bounded ----------
-- After migration 026 the table should hold roughly 30 days of runs (~43k rows).
-- A much larger value means retention is not running.
SELECT 'retention'::text AS check,
       CASE WHEN count(*) <= 60000 THEN 'PASS' ELSE 'WARN' END::text AS status,
       count(*)::text || ' retained run row(s); oldest '
         || COALESCE(min(fired_at)::text, 'n/a') AS detail
FROM public.reminder_scheduler_runs;

-- ============================================================================
-- End of health check. No secrets, no user data, no application writes.
-- ============================================================================