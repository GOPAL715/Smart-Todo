/*
# Production scheduler project configuration correction

This migration replaces only public.invoke_reminder_processor() so the
already-installed pg_cron job dispatches to the current SmartTodo project.
The scheduler's private token remains in Vault and is not changed here.
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

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_reminder_processor() FROM PUBLIC, anon, authenticated;
