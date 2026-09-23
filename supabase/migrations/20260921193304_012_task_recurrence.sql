/*
# Task recurrence: schema + server-side occurrence materialisation

1. Purpose
   A task can now repeat daily, weekly or monthly. When one occurrence of a
   recurring task ends, the next occurrence is created automatically on the
   server — together with its reminders — so the series continues whether or not
   any browser is open and whether or not the user is signed in.

2. Changes to `tasks` (additive only, all nullable so existing rows are untouched)
   - `recurrence`       text  — 'DAILY' | 'WEEKLY' | 'MONTHLY'; NULL = one-off.
   - `recurrence_until` date  — optional last date the series may generate.
   - `series_id`        uuid  — identifies one recurring series. Every occurrence
                                points at the same value; the first occurrence
                                uses its own id.

3. New objects
   - `public.create_task_reminders_for(uuid)`
       Recreates the standard reminder rows for a task. Used only when the server
       materialises a new occurrence. It mirrors the rules the app already applies
       when a user creates a task, because generated occurrences never pass
       through the browser.
   - `public.materialize_recurring_tasks()`
       For every recurring task whose occurrence has ended and which is the latest
       occurrence in its series, inserts the next occurrence and its reminders.
       Called by the existing `pg_cron` job.
   - Partial unique index `idx_tasks_series_start`
       One row per (series, start moment). This is the idempotency guarantee for
       generation: a tick that runs twice, or two ticks overlapping, cannot
       produce a duplicate occurrence.

4. Security
   - `materialize_recurring_tasks()` operates across all users, so EXECUTE is
     revoked from PUBLIC, `anon` and `authenticated`. It is reachable only from
     the scheduler, exactly like `invoke_reminder_processor()`.
   - `create_task_reminders_for()` is likewise revoked from client roles.
   - Both are SECURITY DEFINER with `search_path` pinned to empty and every
     reference schema-qualified.
   - The new columns live on `tasks` and are covered by the existing owner-scoped
     RLS policies; no new grant is introduced and no policy is widened.
   - The reminder-processing path (`process_all_due_reminders`,
     `process_due_reminders`, `process-reminders`, its Vault token) is unchanged.

5. Notes
   1. Occurrence times are advanced by calendar interval on the stored UTC
      instants, which preserves the wall-clock time for the app's timezone
      (Asia/Kolkata has no daylight-saving shift).
   2. A cancelled occurrence ends its series: no further occurrence is generated.
   3. When `recurrence_until` is set, generation stops once the next date would
      fall after it.
   4. The cron job keeps its schedule and still calls `invoke_reminder_processor()`
      first; materialisation is appended, so reminder dispatch is untouched.
   5. Idempotent: columns use IF NOT EXISTS, the index uses IF NOT EXISTS, the
      constraint is added only when absent, and the job is unscheduled by name
      before being recreated.
*/

-- ==================== SCHEMA ====================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence text,
  ADD COLUMN IF NOT EXISTS recurrence_until date,
  ADD COLUMN IF NOT EXISTS series_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_recurrence_check' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_recurrence_check
      CHECK (recurrence IS NULL OR recurrence IN ('DAILY', 'WEEKLY', 'MONTHLY'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_series_start
  ON public.tasks (series_id, start_datetime)
  WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_recurring_due
  ON public.tasks (end_datetime)
  WHERE recurrence IS NOT NULL;

-- ==================== REMINDERS FOR A NEW OCCURRENCE ====================
CREATE OR REPLACE FUNCTION public.create_task_reminders_for(p_task_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task record;
  v_offset integer;
  v_type text;
  v_reminder_time timestamptz;
  v_created integer := 0;
BEGIN
  SELECT id, user_id, start_datetime, end_datetime, reminder_offsets
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- One-off offsets before the start time
  FOREACH v_offset IN ARRAY COALESCE(v_task.reminder_offsets, '{}')
  LOOP
    v_type := CASE v_offset
      WHEN 1440 THEN 'ONE_DAY'
      WHEN 120  THEN 'TWO_HOURS'
      WHEN 60   THEN 'ONE_HOUR'
      WHEN 30   THEN 'THIRTY_MINUTES'
      WHEN 15   THEN 'FIFTEEN_MINUTES'
      WHEN 10   THEN 'TEN_MINUTES'
      WHEN 5    THEN 'FIVE_MINUTES'
      WHEN 0    THEN 'AT_START'
      ELSE 'CUSTOM'
    END;

    v_reminder_time := v_task.start_datetime - make_interval(mins => v_offset);

    IF v_reminder_time > now() THEN
      INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
      VALUES (p_task_id, v_type, v_reminder_time, false)
      ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- Not-started check, 10 minutes after the start
  IF v_task.start_datetime + interval '10 minutes' > now() THEN
    INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
    VALUES (p_task_id, 'NOT_STARTED', v_task.start_datetime + interval '10 minutes', false)
    ON CONFLICT DO NOTHING;
    v_created := v_created + 1;
  END IF;

  -- Overdue check, at the end time
  IF v_task.end_datetime > now() THEN
    INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
    VALUES (p_task_id, 'OVERDUE', v_task.end_datetime, false)
    ON CONFLICT DO NOTHING;
    v_created := v_created + 1;
  END IF;

  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_task_reminders_for(uuid) FROM PUBLIC, anon, authenticated;

-- ==================== MATERIALISE THE NEXT OCCURRENCE ====================
CREATE OR REPLACE FUNCTION public.materialize_recurring_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task record;
  v_step interval;
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_next_date date;
  v_series uuid;
  v_new_id uuid;
  v_created integer := 0;
BEGIN
  FOR v_task IN
    SELECT t.*
    FROM public.tasks t
    WHERE t.recurrence IS NOT NULL
      AND t.status <> 'CANCELLED'
      AND t.end_datetime <= now()
      -- only the latest occurrence of a series generates the next one
      AND NOT EXISTS (
        SELECT 1
        FROM public.tasks later
        WHERE COALESCE(later.series_id, later.id) = COALESCE(t.series_id, t.id)
          AND later.start_datetime > t.start_datetime
      )
    ORDER BY t.end_datetime ASC
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_step := CASE v_task.recurrence
      WHEN 'DAILY'   THEN interval '1 day'
      WHEN 'WEEKLY'  THEN interval '7 days'
      WHEN 'MONTHLY' THEN interval '1 month'
      ELSE NULL
    END;

    IF v_step IS NULL THEN
      CONTINUE;
    END IF;

    v_next_start := v_task.start_datetime + v_step;
    v_next_end := v_task.end_datetime + v_step;
    v_next_date := (v_next_start AT TIME ZONE 'Asia/Kolkata')::date;

    -- Stop the series at the requested end date
    IF v_task.recurrence_until IS NOT NULL AND v_next_date > v_task.recurrence_until THEN
      CONTINUE;
    END IF;

    v_series := COALESCE(v_task.series_id, v_task.id);

    -- The unique index on (series_id, start_datetime) makes this idempotent:
    -- a repeated or overlapping tick inserts nothing.
    INSERT INTO public.tasks (
      user_id, title, description, task_date, start_time, end_time,
      start_datetime, end_datetime, duration_minutes, priority, category,
      status, reminder_offsets, recurrence, recurrence_until, series_id
    )
    VALUES (
      v_task.user_id, v_task.title, v_task.description, v_next_date,
      (v_next_start AT TIME ZONE 'Asia/Kolkata')::time::text,
      (v_next_end   AT TIME ZONE 'Asia/Kolkata')::time::text,
      v_next_start, v_next_end, v_task.duration_minutes, v_task.priority,
      v_task.category, 'PENDING', v_task.reminder_offsets, v_task.recurrence,
      v_task.recurrence_until, v_series
    )
    ON CONFLICT (series_id, start_datetime) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      -- Backfill the series marker on the first occurrence so later ticks can
      -- find the series by a single value.
      IF v_task.series_id IS NULL THEN
        UPDATE public.tasks SET series_id = v_series WHERE id = v_task.id;
      END IF;

      PERFORM public.create_task_reminders_for(v_new_id);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('occurrences_created', v_created, 'timestamp', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.materialize_recurring_tasks() FROM PUBLIC, anon, authenticated;

-- ==================== EXTEND THE EXISTING SCHEDULER ====================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-reminders-every-minute') THEN
    PERFORM cron.unschedule('process-reminders-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'process-reminders-every-minute',
  '* * * * *',
  $$SELECT public.invoke_reminder_processor(); SELECT public.materialize_recurring_tasks();$$
);
