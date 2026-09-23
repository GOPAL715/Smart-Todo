/*
# Scheduler dispatch: send a valid project JWT plus the private scheduler token

1. Why this change
   The edge gateway rejects a request whose Authorization header is not a valid
   project JWT, before the function body runs. A custom bearer therefore cannot
   be used on its own. The dispatch call now sends:
   - `Authorization: Bearer <project anon JWT>` — satisfies the gateway's JWT
     verification. This is a publishable key, not a secret.
   - `X-Scheduler-Token: <secret from Vault>` — the actual authorisation. Only the
     database (which generates it in Vault) and the edge function (which reads it
     with the service-role client) ever see this value.
   Authorisation still requires the private token; presenting only the public JWT
   is rejected, exactly as before.

2. Changes
   - `public.invoke_reminder_processor()` redefined to send both headers.

3. Notes
   1. The public JWT is embedded as a literal because it is publishable by design
      (it already ships in the frontend bundle and is readable by anyone).
   2. The secret remains in Vault and is never written into the function body.
   3. Idempotent: CREATE OR REPLACE, and the cron job continues to point at this
      function by name.
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
  v_url constant text := 'https://wncupbiwgxssokwemcqe.supabase.co/functions/v1/process-reminders';
  -- Publishable project key. It is not a secret: it already ships in the
  -- browser bundle and its only role here is to satisfy gateway JWT
  -- verification. Authorisation is performed by the Vault token below.
  v_public_jwt constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduY3VwYml3Z3hzc29rd2VtY3FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDQ5MzcsImV4cCI6MjEwNTU4MDkzN30.6l1J3QYIkefo4cX_X1y9JAWz-vvP7huT5WInEhxPCww';
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

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_reminder_processor() FROM PUBLIC, anon, authenticated;
