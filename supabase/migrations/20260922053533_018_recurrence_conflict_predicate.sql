/*
# Restore the partial-index predicate on recurrence generation

Migration 017 redefined `materialize_recurring_tasks()` for timezone-aware
generation but omitted the `WHERE series_id IS NOT NULL` predicate in its
`ON CONFLICT` clause. `idx_tasks_series_start` is a *partial* unique index, and
PostgreSQL only uses such an index for conflict inference when the index
predicate is repeated in the insert, so materialisation failed with
"no unique or exclusion constraint matching the ON CONFLICT specification".

This migration restores 013's predicate while keeping 017's timezone-aware,
DST-safe generation. Behaviour and the idempotency guarantee are unchanged: a
repeated or overlapping tick still cannot insert a second occurrence.
Idempotent: CREATE OR REPLACE, and the cron job continues to call the function
by name.
*/

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
    ELSE
      v_tz := v_task.owner_tz;
    END IF;
    v_lock := true;

    v_step := CASE v_task.recurrence
      WHEN 'DAILY'   THEN interval '1 day'
      WHEN 'WEEKLY'  THEN interval '7 days'
      WHEN 'MONTHLY' THEN interval '1 month'
      ELSE NULL
    END;

    IF v_step IS NULL THEN
      CONTINUE;
    END IF;

    -- Step by local wall-clock, then resolve back to UTC instants (DST-aware).
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
    ON CONFLICT (series_id, start_datetime) WHERE series_id IS NOT NULL DO NOTHING
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
