/*
# Production reminder scheduler (pg_cron -> pg_net -> process-reminders)

1. Purpose
   Reminder notifications must be produced with no browser open and no signed-in
   user. This migration installs a server-side scheduler that calls the
   `process-reminders` edge function once a minute, and removes the temporary
   smoke-test scaffolding used to prove the scheduler runs.

2. How the pieces fit together
   - `pg_cron`        — fires SQL once a minute, inside the database.
   - `pg_net`         — makes the outbound HTTPS call to the edge function.
   - `vault`          — holds the bearer token the scheduler presents. The token
                        is generated inside the database and never leaves it
                        except in the outbound request header.
   - Edge function    — keeps its existing checks and additionally accepts this
                        narrowly-scoped scheduler token.

3. New objects
   - `public.reminder_scheduler_runs`
       Audit/health table. One row per scheduled invocation, recording the
       `pg_net` request id and when the job fired. Lets an operator confirm the
       scheduler is alive and see failures.
   - `public.invoke_reminder_processor()` (SECURITY DEFINER)
       Reads the bearer token from Vault and POSTs to the `process-reminders`
       endpoint. Called only by the cron job. EXECUTE is revoked from PUBLIC,
       anon and authenticated, so it is not reachable from the app.
   - `public.get_reminder_scheduler_token()` (SECURITY DEFINER)
       Returns the token so the edge function can compare against it. EXECUTE is
       revoked from PUBLIC, anon and authenticated — only the service-role client
       inside the edge function can read it.
   - Vault secret `process_reminders_scheduler_token`
       A 256-bit random token, created here with `gen_random_bytes` when absent.
   - Cron job `process-reminders-every-minute` — schedule `* * * * *`.

4. Security
   - RLS is enabled on `reminder_scheduler_runs` with no policies, so no client
     role can read it. The scheduler writes as its owner.
   - Both new functions are SECURITY DEFINER with `search_path` pinned to empty,
     and all object references are schema-qualified.
   - The scheduler token is a dedicated, least-privilege credential: it can only
     trigger reminder processing, not perform arbitrary admin actions. The
     service-role path in the edge function is unchanged.
   - Nothing here exposes a credential to the frontend.

5. Notes
   1. The edge-function URL is the project's own endpoint. If the project is ever
      moved to a different host, update it in `invoke_reminder_processor`.
   2. If an invocation fails (network error, non-2xx), the row in
      `reminder_scheduler_runs` still records the attempt and `pg_net` stores the
      response in `net._http_response` for inspection. The next minute's run
      retries automatically; unprocessed reminders stay `is_sent = false` and are
      picked up then, so a missed tick delays but never loses a reminder.
   3. Idempotency is unchanged: `process_all_due_reminders` only selects
      `is_sent = false` rows under `FOR UPDATE SKIP LOCKED` and sets
      `is_sent = true` in the same transaction, so running twice creates nothing
      extra.
   4. Idempotent: the smoke-test job/table are dropped, the cron job is
      unscheduled by name before re-creating, and the Vault secret is only
      created when missing.
*/

-- ---------- remove the smoke-test scaffolding ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'smoke-test-every-minute') THEN
    PERFORM cron.unschedule('smoke-test-every-minute');
  END IF;
END $$;

DROP TABLE IF EXISTS public.cron_smoke_test;

-- ---------- scheduler health / audit table ----------
CREATE TABLE IF NOT EXISTS public.reminder_scheduler_runs (
  id bigserial PRIMARY KEY,
  request_id bigint,
  fired_at timestamptz NOT NULL DEFAULT now(),
  note text
);

ALTER TABLE public.reminder_scheduler_runs ENABLE ROW LEVEL SECURITY;

-- ---------- the credential, generated in-database, stored in Vault ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'process_reminders_scheduler_token') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'process_reminders_scheduler_token',
      'Bearer token presented by the pg_cron job to the process-reminders edge function'
    );
  END IF;
END $$;

-- ---------- privileged read of the token, service-role only ----------
CREATE OR REPLACE FUNCTION public.get_reminder_scheduler_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'process_reminders_scheduler_token'
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_reminder_scheduler_token() FROM PUBLIC, anon, authenticated;

-- ---------- the scheduled invocation itself ----------
CREATE OR REPLACE FUNCTION public.invoke_reminder_processor()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_request_id bigint;
  v_url constant text := 'https://wncupbiwgxssokwemcqe.supabase.co/functions/v1/process-reminders';
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
      'Authorization', 'Bearer ' || v_token
    ),
    timeout_milliseconds := 10000
  );

  INSERT INTO public.reminder_scheduler_runs (request_id, note)
  VALUES (v_request_id, 'dispatched');

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_reminder_processor() FROM PUBLIC, anon, authenticated;

-- ---------- schedule it every minute ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-reminders-every-minute') THEN
    PERFORM cron.unschedule('process-reminders-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'process-reminders-every-minute',
  '* * * * *',
  $$SELECT public.invoke_reminder_processor();$$
);
