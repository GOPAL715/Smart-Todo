/*
# Production audit hardening

This migration contains only approved corrections:
- preserve the series timezone at recurring-task creation;
- rebuild pending reminders transactionally when an owner changes a task;
- require tag ownership for task-tag deletion by EDIT collaborators;
- harden the three older SECURITY DEFINER functions;
- add integrity checks and maintain updated_at timestamps.

No scheduler, cron job, Edge Function, or historical migration is changed.
*/

-- ==================== RECURRING SERIES TIMEZONE ====================

-- Existing recurring rows are made deterministic before the new invariant is
-- enforced. The fallback is only for legacy rows without a profile timezone.
UPDATE public.tasks AS t
SET schedule_timezone = p.timezone
FROM public.profiles AS p
WHERE p.id = t.user_id
  AND t.recurrence IS NOT NULL
  AND t.schedule_timezone IS NULL;

UPDATE public.tasks
SET series_timezone_locked = true
WHERE recurrence IS NOT NULL
  AND schedule_timezone IS NOT NULL;

UPDATE public.tasks
SET schedule_timezone = 'Asia/Kolkata',
    series_timezone_locked = true
WHERE recurrence IS NOT NULL
  AND schedule_timezone IS NULL;

CREATE OR REPLACE FUNCTION public.prepare_task_series_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_timezone text;
BEGIN
  IF NEW.recurrence IS NULL THEN
    -- A one-off task never carries recurring-series state. This also makes
    -- direct API writes deterministic instead of trusting client columns.
    NEW.schedule_timezone := NULL;
    NEW.series_timezone_locked := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.schedule_timezone IS NULL THEN
      SELECT p.timezone INTO v_owner_timezone
      FROM public.profiles AS p
      WHERE p.id = NEW.user_id;
      NEW.schedule_timezone := COALESCE(v_owner_timezone, 'Asia/Kolkata');
    END IF;
    NEW.series_timezone_locked := true;
    RETURN NEW;
  END IF;

  -- Once a series is locked, profile changes and later task edits cannot move
  -- its wall-clock schedule to another timezone.
  IF OLD.series_timezone_locked AND OLD.recurrence IS NOT NULL THEN
    NEW.schedule_timezone := OLD.schedule_timezone;
    NEW.series_timezone_locked := true;
    RETURN NEW;
  END IF;

  IF NEW.schedule_timezone IS NULL THEN
    SELECT p.timezone INTO v_owner_timezone
    FROM public.profiles AS p
    WHERE p.id = NEW.user_id;
    NEW.schedule_timezone := COALESCE(v_owner_timezone, 'Asia/Kolkata');
  END IF;
  NEW.series_timezone_locked := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_task_series_timezone ON public.tasks;
CREATE TRIGGER trg_prepare_task_series_timezone
BEFORE INSERT OR UPDATE OF recurrence, schedule_timezone, series_timezone_locked
ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.prepare_task_series_timezone();

-- ==================== TRANSACTIONAL PENDING REMINDER REBUILD ====================

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

  FOREACH v_offset IN ARRAY COALESCE(v_task.reminder_offsets, '{}'::integer[])
  LOOP
    IF v_offset NOT IN (1440, 120, 60, 30, 15, 10, 5, 0) THEN
      RAISE EXCEPTION 'Unsupported reminder offset: %', v_offset;
    END IF;
    v_type := CASE v_offset
      WHEN 1440 THEN 'ONE_DAY'
      WHEN 120  THEN 'TWO_HOURS'
      WHEN 60   THEN 'ONE_HOUR'
      WHEN 30   THEN 'THIRTY_MINUTES'
      WHEN 15   THEN 'FIFTEEN_MINUTES'
      WHEN 10   THEN 'TEN_MINUTES'
      WHEN 5    THEN 'FIVE_MINUTES'
      WHEN 0    THEN 'AT_START'
    END;
    v_reminder_time := v_task.start_datetime - make_interval(mins => v_offset);
    IF v_reminder_time > now() THEN
      INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
      VALUES (p_task_id, v_type, v_reminder_time, false)
      ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
    END IF;
  END LOOP;

  IF v_task.start_datetime + interval '10 minutes' > now() THEN
    INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
    VALUES (p_task_id, 'NOT_STARTED', v_task.start_datetime + interval '10 minutes', false)
    ON CONFLICT DO NOTHING;
    v_created := v_created + 1;
  END IF;

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


CREATE OR REPLACE FUNCTION public.refresh_task_pending_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_offset integer;
  v_type text;
  v_reminder_time timestamptz;
BEGIN
  -- EDIT collaborators may edit the task, but task reminders remain owner-only.
  -- The trigger therefore performs this maintenance only for the owner.
  IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.task_reminders
  WHERE task_id = NEW.id AND is_sent = false;

  FOREACH v_offset IN ARRAY COALESCE(NEW.reminder_offsets, '{}'::integer[])
  LOOP
    IF v_offset NOT IN (1440, 120, 60, 30, 15, 10, 5, 0) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format('Unsupported reminder offset: %', v_offset);
    END IF;
    v_type := CASE v_offset
      WHEN 1440 THEN 'ONE_DAY'
      WHEN 120  THEN 'TWO_HOURS'
      WHEN 60   THEN 'ONE_HOUR'
      WHEN 30   THEN 'THIRTY_MINUTES'
      WHEN 15   THEN 'FIFTEEN_MINUTES'
      WHEN 10   THEN 'TEN_MINUTES'
      WHEN 5    THEN 'FIVE_MINUTES'
      WHEN 0    THEN 'AT_START'
    END;
    v_reminder_time := NEW.start_datetime - make_interval(mins => v_offset);
    IF v_reminder_time > now() THEN
      INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
      VALUES (NEW.id, v_type, v_reminder_time, false)
      ON CONFLICT (task_id, reminder_type, reminder_time) DO NOTHING;
    END IF;
  END LOOP;

  IF NEW.start_datetime + interval '10 minutes' > now() THEN
    INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
    VALUES (NEW.id, 'NOT_STARTED', NEW.start_datetime + interval '10 minutes', false)
    ON CONFLICT (task_id, reminder_type, reminder_time) DO NOTHING;
  END IF;

  IF NEW.end_datetime > now() THEN
    INSERT INTO public.task_reminders (task_id, reminder_type, reminder_time, is_sent)
    VALUES (NEW.id, 'OVERDUE', NEW.end_datetime, false)
    ON CONFLICT (task_id, reminder_type, reminder_time) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_task_pending_reminders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refresh_task_pending_reminders ON public.tasks;
CREATE TRIGGER trg_refresh_task_pending_reminders
AFTER UPDATE OF task_date, start_datetime, end_datetime, reminder_offsets
ON public.tasks
FOR EACH ROW
WHEN (NEW.status <> 'CANCELLED')
EXECUTE FUNCTION public.refresh_task_pending_reminders();

-- ==================== TASK TAG DELETE AUTHORIZATION ====================

DROP POLICY IF EXISTS "delete_task_tags" ON public.task_tags;
CREATE POLICY "delete_task_tags" ON public.task_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND t.user_id = auth.uid()
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.tasks t
        JOIN public.task_shares s ON s.task_id = t.id
        WHERE t.id = task_tags.task_id
          AND s.shared_with = auth.uid()
          AND s.permission = 'EDIT'
      )
      AND EXISTS (
        SELECT 1 FROM public.tags g
        WHERE g.id = task_tags.tag_id
          AND g.user_id = auth.uid()
      )
    )
  );
-- ==================== SECURITY DEFINER SEARCH-PATH HARDENING ====================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_processed integer := 0;
  v_user_id uuid := auth.uid();
  v_reminder record;
  v_task record;
  v_notification_title text;
  v_notification_message text;
  v_should_notify boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('processed', 0, 'error', 'no authenticated user');
  END IF;

  FOR v_reminder IN
    SELECT tr.id, tr.task_id, tr.reminder_type, tr.reminder_time, tr.is_sent
    FROM public.task_reminders tr
    INNER JOIN public.tasks t ON t.id = tr.task_id
    WHERE tr.is_sent = false
      AND tr.reminder_time <= v_now
      AND t.user_id = v_user_id
    ORDER BY tr.reminder_time ASC
    FOR UPDATE OF tr SKIP LOCKED
  LOOP
    SELECT * INTO v_task FROM public.tasks WHERE id = v_reminder.task_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_task.status = 'CANCELLED' THEN
      UPDATE public.task_reminders
      SET is_sent = true, sent_at = v_now
      WHERE id = v_reminder.id;
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;


    v_should_notify := true;
    v_notification_title := '';
    v_notification_message := '';

    CASE v_reminder.reminder_type
      WHEN 'ONE_DAY' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 day.';
      WHEN 'TWO_HOURS' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 2 hours.';
      WHEN 'ONE_HOUR' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 hour.';
      WHEN 'THIRTY_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 30 minutes.';
      WHEN 'FIFTEEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 15 minutes.';
      WHEN 'TEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 10 minutes.';
      WHEN 'FIVE_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 5 minutes.';
      WHEN 'AT_START' THEN
        v_notification_title := 'Task starting now';
        v_notification_message := 'It''s time to start: ' || v_task.title || '.';
        IF v_task.status = 'PENDING' THEN
          UPDATE public.tasks SET status = 'IN_PROGRESS', updated_at = v_now WHERE id = v_task.id;
        END IF;
      WHEN 'NOT_STARTED' THEN
        v_notification_title := 'Task not started';
        v_notification_message := 'You haven''t started your task yet: ' || v_task.title || '.';
        IF v_task.status != 'PENDING' THEN
          v_should_notify := false;
        END IF;
      WHEN 'OVERDUE' THEN
        v_notification_title := 'Task overdue';
        v_notification_message := 'Your task "' || v_task.title || '" was scheduled to finish but is not completed.';
        IF v_task.status NOT IN ('COMPLETED', 'CANCELLED') THEN
          UPDATE public.tasks SET status = 'OVERDUE', updated_at = v_now WHERE id = v_task.id;
        ELSE
          v_should_notify := false;
        END IF;
      ELSE
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" is coming up.';
    END CASE;

    IF v_should_notify THEN
      INSERT INTO public.notifications (user_id, task_id, title, message, type, is_read)
      VALUES (v_task.user_id, v_task.id, v_notification_title, v_notification_message, 'IN_APP', false);
    END IF;

    UPDATE public.task_reminders
    SET is_sent = true, sent_at = v_now
    WHERE id = v_reminder.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'timestamp', v_now);
END;
$$;


CREATE OR REPLACE FUNCTION public.process_all_due_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_processed integer := 0;
  v_reminder record;
  v_task record;
  v_notification_title text;
  v_notification_message text;
  v_should_notify boolean;
BEGIN
  FOR v_reminder IN
    SELECT tr.id, tr.task_id, tr.reminder_type, tr.reminder_time, tr.is_sent
    FROM public.task_reminders tr
    INNER JOIN public.tasks t ON t.id = tr.task_id
    WHERE tr.is_sent = false
      AND tr.reminder_time <= v_now
    ORDER BY tr.reminder_time ASC
    FOR UPDATE OF tr SKIP LOCKED
  LOOP
    SELECT * INTO v_task FROM public.tasks WHERE id = v_reminder.task_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF v_task.status = 'CANCELLED' THEN
      UPDATE public.task_reminders
      SET is_sent = true, sent_at = v_now
      WHERE id = v_reminder.id;
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;



    v_should_notify := true;
    v_notification_title := '';
    v_notification_message := '';

    CASE v_reminder.reminder_type
      WHEN 'ONE_DAY' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 day.';
      WHEN 'TWO_HOURS' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 2 hours.';
      WHEN 'ONE_HOUR' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 hour.';
      WHEN 'THIRTY_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 30 minutes.';
      WHEN 'FIFTEEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 15 minutes.';
      WHEN 'TEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 10 minutes.';
      WHEN 'FIVE_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 5 minutes.';
      WHEN 'AT_START' THEN
        v_notification_title := 'Task starting now';
        v_notification_message := 'It''s time to start: ' || v_task.title || '.';
        IF v_task.status = 'PENDING' THEN
          UPDATE public.tasks SET status = 'IN_PROGRESS', updated_at = v_now WHERE id = v_task.id;
        END IF;
      WHEN 'NOT_STARTED' THEN
        v_notification_title := 'Task not started';
        v_notification_message := 'You haven''t started your task yet: ' || v_task.title || '.';
        IF v_task.status != 'PENDING' THEN
          v_should_notify := false;
        END IF;
      WHEN 'OVERDUE' THEN
        v_notification_title := 'Task overdue';
        v_notification_message := 'Your task "' || v_task.title || '" was scheduled to finish but is not completed.';
        IF v_task.status NOT IN ('COMPLETED', 'CANCELLED') THEN
          UPDATE public.tasks SET status = 'OVERDUE', updated_at = v_now WHERE id = v_task.id;
        ELSE
          v_should_notify := false;
        END IF;
      ELSE
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" is coming up.';
    END CASE;

    IF v_should_notify THEN
      INSERT INTO public.notifications (user_id, task_id, title, message, type, is_read)
      VALUES (v_task.user_id, v_task.id, v_notification_title, v_notification_message, 'IN_APP', false);
    END IF;

    UPDATE public.task_reminders
    SET is_sent = true, sent_at = v_now
    WHERE id = v_reminder.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'timestamp', v_now);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_due_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_all_due_reminders() FROM PUBLIC, anon, authenticated;


-- ==================== INTEGRITY CONSTRAINTS ====================

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_title_not_blank,
  DROP CONSTRAINT IF EXISTS tasks_time_order_valid,
  DROP CONSTRAINT IF EXISTS tasks_duration_positive,
  DROP CONSTRAINT IF EXISTS tasks_recurrence_until_valid,
  DROP CONSTRAINT IF EXISTS tasks_reminder_offsets_valid,
  DROP CONSTRAINT IF EXISTS tasks_series_timezone_state_valid,
  ADD CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT tasks_time_order_valid CHECK (end_datetime > start_datetime),
  ADD CONSTRAINT tasks_duration_positive CHECK (duration_minutes > 0),
  ADD CONSTRAINT tasks_recurrence_until_valid CHECK (recurrence_until IS NULL OR recurrence_until >= task_date),
  ADD CONSTRAINT tasks_reminder_offsets_valid CHECK (
    array_position(reminder_offsets, NULL) IS NULL
    AND reminder_offsets <@ ARRAY[0,5,10,15,30,60,120,1440]::integer[]
  ),
  ADD CONSTRAINT tasks_series_timezone_state_valid CHECK (
    (recurrence IS NULL AND schedule_timezone IS NULL AND series_timezone_locked = false)
    OR (
      recurrence IS NOT NULL
      AND schedule_timezone IS NOT NULL
      AND series_timezone_locked = true
      AND public.is_valid_timezone(schedule_timezone)
    )
  );

ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS tags_name_valid,
  ADD CONSTRAINT tags_name_valid CHECK (char_length(btrim(name)) BETWEEN 1 AND 100);

ALTER TABLE public.subtasks
  DROP CONSTRAINT IF EXISTS subtasks_title_valid,
  DROP CONSTRAINT IF EXISTS subtasks_position_nonnegative,
  ADD CONSTRAINT subtasks_title_valid CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  ADD CONSTRAINT subtasks_position_nonnegative CHECK (position >= 0);

ALTER TABLE public.task_reminders
  DROP CONSTRAINT IF EXISTS task_reminders_reminder_type_check,
  ADD CONSTRAINT task_reminders_reminder_type_check CHECK (
    reminder_type IN (
      'ONE_DAY', 'TWO_HOURS', 'ONE_HOUR', 'THIRTY_MINUTES',
      'FIFTEEN_MINUTES', 'TEN_MINUTES', 'FIVE_MINUTES', 'AT_START',
      'NOT_STARTED', 'OVERDUE'
    )
  ),
  DROP CONSTRAINT IF EXISTS task_reminders_sent_state_valid,
  ADD CONSTRAINT task_reminders_sent_state_valid CHECK (
    (is_sent = false AND sent_at IS NULL) OR (is_sent = true AND sent_at IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reminders_logical_unique
  ON public.task_reminders (task_id, reminder_type, reminder_time);

-- ==================== UPDATED_AT MAINTENANCE ====================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_subtasks_updated_at ON public.subtasks;
CREATE TRIGGER trg_subtasks_updated_at
BEFORE UPDATE ON public.subtasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

