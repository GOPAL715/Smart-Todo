/*
# Correct the recurrence generation conflict clause

1. Why this change
   `idx_tasks_series_start` is a *partial* unique index. PostgreSQL only uses such
   an index for `ON CONFLICT` inference when the index predicate is repeated in
   the statement, so the insert must carry
   `WHERE series_id IS NOT NULL` matching the index. Without it PostgreSQL cannot
   infer a unique constraint and the statement fails.

2. Changes
   - `public.materialize_recurring_tasks()` redefined with the predicate included
     in its `ON CONFLICT` clause.

3. Notes
   1. Behaviour and the idempotency guarantee are unchanged: a repeated or
      overlapping tick still cannot insert a second occurrence.
   2. Idempotent: CREATE OR REPLACE, and the cron job continues to call the
      function by name.
*/

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

    IF v_task.recurrence_until IS NOT NULL AND v_next_date > v_task.recurrence_until THEN
      CONTINUE;
    END IF;

    v_series := COALESCE(v_task.series_id, v_task.id);

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
    ON CONFLICT (series_id, start_datetime) WHERE series_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
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
