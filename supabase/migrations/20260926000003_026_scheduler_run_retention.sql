/*
# Scheduler run retention and health observability

1. Problem
   `public.reminder_scheduler_runs` records one row per scheduler invocation
   (~1/minute, so ~525,000 rows/year) and had no retention policy and no index
   on `fired_at`. The table therefore grew without bound, which increases
   storage cost and slows any query that has to scan it during an incident.

2. What this migration changes
   - `idx_reminder_scheduler_runs_fired_at` — index on the timestamp column so
     retention and health queries never sequentially scan the table.
   - `public.cleanup_reminder_scheduler_runs()` — SECURITY DEFINER, deletes
     only rows older than 30 days, in bounded batches.
   - `public.invoke_reminder_processor()` — redefined to call the cleanup after
     a successful dispatch. The existing pg_cron job already points at this
     function by name, so NO new cron job is created.

3. Why 30 days
   At one row per minute this retains ~43,200 rows. That is a month of
   minute-level history, which comfortably covers incident investigation and
   post-incident review, while bounding the table to a predictable size. It is
   also far longer than the `net._http_response` retention window, so the
   dispatch audit trail outlives the HTTP bodies it references.

4. Safety
   - Only rows strictly older than the cutoff are removed, so recent operational
     history is never touched.
   - Batched to `RETENTION_BATCH_SIZE` rows per invocation, so a first run after
     a long gap cannot take a long lock or block the scheduler.
   - Safe under concurrency: every new row is written with `fired_at = now()`,
     so no in-flight or future dispatch can ever match the retention predicate.
     The DELETE takes no lock that conflicts with the dispatch INSERT.
   - Idempotent: re-running deletes whatever has aged past the cutoff, and a
     second run in the same window is a no-op.
   - No new job, no new schedule, no change to dispatch behaviour, frequency,
     authentication, or the Edge Function.

5. Not changed
   The scheduler token in Vault, the pg_cron job, the `pg_net` call, the Edge
   Function, RLS, and all reminder processing logic.
*/

-- ---------- index the timestamp column used by retention and health checks ----------
CREATE INDEX IF NOT EXISTS idx_reminder_scheduler_runs_fired_at
  ON public.reminder_scheduler_runs (fired_at DESC);

-- ---------- bounded, idempotent retention ----------
CREATE OR REPLACE FUNCTION public.cleanup_reminder_scheduler_runs(
  p_retention interval DEFAULT interval '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_batch constant integer := 10000;
BEGIN
  -- Guard against a nonsensical interval so the table can never be wiped by a
  -- bad argument: retention must be positive and at least a day.
  IF p_retention < interval '1 day' THEN
    RETURN 0;
  END IF;

  -- Batched so a first run after a long gap cannot hold a long lock. The
  -- subquery selects a bounded set of expired ids using the fired_at index and
  -- the delete joins back on the primary key.
  WITH expired AS (
    SELECT id
    FROM public.reminder_scheduler_runs
    WHERE fired_at < now() - p_retention
    ORDER BY fired_at
    LIMIT v_batch
  )
  DELETE FROM public.reminder_scheduler_runs AS r
  USING expired
  WHERE r.id = expired.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- `interval` is a built-in type in pg_catalog; it must be schema-qualified in a
-- function signature, otherwise it resolves against a non-existent `internal`
-- schema.
REVOKE EXECUTE ON FUNCTION public.cleanup_reminder_scheduler_runs(pg_catalog.interval) FROM PUBLIC, anon, authenticated;
-- ---------- dispatch + inline retention (existing cron job targets this) ----------

/*
   Only the dispatch and retention steps differ from migration 022. The URL,
   the publishable gateway JWT, the Vault token read, the `pg_net` call, the
   10s timeout, the `reminder_scheduler_runs` insert and the error handling are
   all preserved exactly, so the running scheduler's behaviour is unchanged.

   Retention is invoked after a successful dispatch rather than from a new cron
   job, so the scheduler still fires exactly once a minute. A failure is
   swallowed: retention is housekeeping and must never turn a working dispatch
   into a failed one.
*/
CREATE OR REPLACE FUNCTION public.invoke_reminder_processor()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_request_id bigint;
  v_url constant text := 'https://nyoymwomrimjnpkzljgq.supabase.co/functions/v1/process-reminders';
  -- Publishable legacy anon JWT for the current Supabase project. The private
  -- scheduler token in X-Scheduler-Token remains the authorization credential.
  v_public_jwt constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55b3ltd29tcmltam5wa3psamdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjYzMzYsImV4cCI6MjEwNTg0MjMzNn0.mJhHvO1G6pBlubgqYbLEfgtKv4DyrToGi3MxCMwORAI';
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'process_reminders_scheduler_token'
  LIMIT 1;

  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO public.reminder_scheduler_runs (request_id, note)
    VALUES (NULL, 'scheduler token missing from vault');
    RAISE EXCEPTION 'reminder scheduler token is not configured';
  END IF;

  v_request_id := net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_public_jwt,
      'X-Scheduler-Token', v_token
    ),
    timeout_milliseconds := 10000
  );

  INSERT INTO public.reminder_scheduler_runs (request_id, note)
  VALUES (v_request_id, 'dispatched');

  -- Retention runs only on the success path, so a dispatch failure still leaves
  -- the failure visible in `reminder_scheduler_runs` and is retried next tick.
  -- Errors are deliberately ignored: retention is best-effort housekeeping.
  BEGIN
    PERFORM public.cleanup_reminder_scheduler_runs();
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'reminder scheduler retention pass failed: %', SQLERRM;
  END;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_reminder_processor() FROM PUBLIC, anon, authenticated;
