/*
# Timezone-aware, DST-safe server-side recurrence

1. Problem
   `materialize_recurring_tasks()` (012) advanced occurrences by a fixed interval
   on the stored UTC instants and rendered dates/times through hardcoded
   'Asia/Kolkata'. That preserves wall-clock only because Kolkata has no DST.
   In a DST zone, "Friday 4 PM New York" drifts to 3 PM after spring-forward.

2. Approach — wall-clock preservation
   The owner's timezone lives on `profiles.timezone` (016). The generator still
   works purely on UTC instants, but steps the series by LOCAL wall-clock:

     local := start_datetime AT TIME ZONE tz        (naive local time)
     next_local := local + '1 day' | '7 days' | '1 month'
     next_start := next_local AT TIME ZONE tz       (back to a UTC instant)

   Adding a calendar interval to a naive timestamp preserves the wall-clock
   digits; converting back resolves the correct UTC offset for that instant
   (DST-aware, via the IANA database bundled with Postgres). So 4:00 PM stays
   4:00 PM across DST transitions, while the stored UTC instant shifts.

   task_date, start_time, end_time text and the recurrence_until comparison are
   all derived in the owner's zone.

3. Schedule timezone on the series
   - `tasks.schedule_timezone text` — the IANA zone the series runs in.
   - `tasks.series_timezone_locked boolean NOT NULL DEFAULT false`
     Series semantics must not drift when the user changes their preference
     later: the first materialisation stamps the owner's zone and locks it for
     the series; later occurrences inherit it. One-off tasks never use it.
   Changing one's timezone preference therefore does NOT rewrite existing task
   schedules — it affects tasks created afterwards. Existing rows are backfilled
   from the owner's profile without touching their UTC times.

4. Security
   - Same objects and grants as 012; the function stays revoked from PUBLIC,
     `anon` and `authenticated`, reachable only from the scheduler. No policy is
     widened. Idempotent: IF NOT EXISTS, CREATE OR REPLACE.
*/

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS schedule_timezone text,
  ADD COLUMN IF NOT EXISTS series_timezone_locked boolean NOT NULL DEFAULT false;

-- Stamp the owner's timezone on existing rows without touching their UTC times.
UPDATE public.tasks t
SET schedule_timezone = COALESCE(p.timezone, 'Asia/Kolkata')
FROM public.profiles p
WHERE p.id = t.user_id
  AND t.schedule_timezone IS NULL;

UPDATE public.tasks
SET schedule_timezone = 'Asia/Kolkata'
WHERE schedule_timezone IS NULL;

CREATE OR REPLACE FUNCTION public.materialize_recurring_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task record;
  v_tz text;
  v_step interval;
  v_local_start timestamp;
  v_local_end timestamp;
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_next_date date;
  v_series uuid;
  v_new_id uuid;
  v_created integer := 0;
  v_lock boolean;
BEGIN
  FOR v_task IN
    SELECT t.*, COALESCE(p.timezone, 'Asia/Kolkata') AS owner_tz
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.user_id
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
    -- A locked series keeps its original zone; a new series adopts the
    -- owner's current zone and locks it from now on.
    IF v_task.series_timezone_locked THEN
      v_tz := COALESCE(v_task.schedule_timezone, v_task.owner_tz);
      v_lock := true;
    ELSE
      v_tz := v_task.owner_tz;
      v_lock := true;
    END IF;

    v_step := CASE v_task.recurrence
      WHEN 'DAILY'   THEN interval '1 day'
      WHEN 'WEEKLY'  THEN interval '7 days'
      WHEN 'MONTHLY' THEN interval '1 month'
      ELSE NULL
    END;

    IF v_step IS NULL THEN
      CONTINUE;
    END IF;

    -- Step by local wall-clock, then resolve back to UTC instants.
    v_local_start := v_task.start_datetime AT TIME ZONE v_tz;
    v_local_end   := v_task.end_datetime   AT TIME ZONE v_tz;

    v_next_start := (v_local_start + v_step) AT TIME ZONE v_tz;
    v_next_end   := (v_local_end   + v_step) AT TIME ZONE v_tz;
    v_next_date  := (v_next_start AT TIME ZONE v_tz)::date;

    -- Stop the series at the requested end date, evaluated in the series zone.
    IF v_task.recurrence_until IS NOT NULL AND v_next_date > v_task.recurrence_until THEN
      CONTINUE;
    END IF;

    v_series := COALESCE(v_task.series_id, v_task.id);

    -- The unique index on (series_id, start_datetime) keeps this idempotent:
    -- a repeated or overlapping tick inserts nothing.
    INSERT INTO public.tasks (
      user_id, title, description, task_date, start_time, end_time,
      start_datetime, end_datetime, duration_minutes, priority, category,
      status, reminder_offsets, recurrence, recurrence_until, series_id,
      schedule_timezone, series_timezone_locked
    )
    VALUES (
      v_task.user_id, v_task.title, v_task.description, v_next_date,
      (v_next_start AT TIME ZONE v_tz)::time::text,
      (v_next_end   AT TIME ZONE v_tz)::time::text,
      v_next_start, v_next_end, v_task.duration_minutes, v_task.priority,
      v_task.category, 'PENDING', v_task.reminder_offsets, v_task.recurrence,
      v_task.recurrence_until, v_series,
      v_tz, v_lock
    )
    ON CONFLICT (series_id, start_datetime) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      -- Backfill the series marker and lock the zone on the first occurrence.
      UPDATE public.tasks
      SET series_id = v_series,
          schedule_timezone = COALESCE(schedule_timezone, v_tz),
          series_timezone_locked = true
      WHERE id = v_task.id;

      PERFORM public.create_task_reminders_for(v_new_id);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('occurrences_created', v_created, 'timestamp', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.materialize_recurring_tasks() FROM PUBLIC, anon, authenticated;
