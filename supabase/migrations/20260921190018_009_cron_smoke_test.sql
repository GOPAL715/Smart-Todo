/*
# Smoke test: confirm the pg_cron scheduler actually executes jobs

1. Purpose
   Before building the real reminder scheduler, prove that pg_cron is running
   on this project (the extension is installed but the background worker must
   also be active).

2. Changes
   - Create a temporary heartbeat table `public.cron_smoke_test`.
   - Schedule a job `smoke-test-every-minute` that appends a row each minute.

3. Notes
   1. This migration is temporary scaffolding and is removed by the next migration.
   2. If rows stop appearing, the scheduler is not running and the real job
      would never fire either.
*/

CREATE TABLE IF NOT EXISTS public.cron_smoke_test (
  id bigserial PRIMARY KEY,
  tick_at timestamptz NOT NULL DEFAULT now()
);

SELECT cron.schedule(
  'smoke-test-every-minute',
  '* * * * *',
  $$INSERT INTO public.cron_smoke_test (tick_at) VALUES (now());$$
);
