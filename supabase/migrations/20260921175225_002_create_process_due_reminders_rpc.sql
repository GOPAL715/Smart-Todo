/*
# Create process_due_reminders RPC function

## Overview
Creates a SECURITY DEFINER PL/pgSQL function that processes all due reminders
for the calling user. This is the core scheduler logic — called every 60 seconds
by the frontend.

## How it works
1. Finds all unsent reminders where reminder_time <= now() AND the reminder belongs
   to the calling user (via the task's user_id).
2. Uses FOR UPDATE SKIP LOCKED to prevent concurrent double-processing (idempotent).
3. For each reminder:
   - Checks the task's current status to decide if the notification should fire
     (e.g., NOT_STARTED only fires if task is still PENDING, OVERDUE only if
     not COMPLETED/CANCELLED).
   - Creates an IN_APP notification with the appropriate message.
   - Transitions task status: PENDING -> IN_PROGRESS at start time,
     PENDING/IN_PROGRESS -> OVERDUE at end time if not completed/cancelled.
4. Marks each processed reminder as sent with sent_at timestamp.
5. Returns the count of processed reminders.

## Idempotency
- FOR UPDATE SKIP LOCKED prevents the same reminder being processed twice.
- is_sent = true ensures a processed reminder is never picked up again.
- The function can be called multiple times safely.

## Security
- SECURITY DEFINER so it can update task_reminders and insert notifications
  (which the client has RLS access to, but the function ensures atomicity).
- The function only processes the calling user's reminders (auth.uid() filter).
- No user_id is hard-coded.

## Important notes
1. The function is transactional by default in Postgres.
2. Notifications are inserted with the calling user's user_id.
3. Task status transitions happen inside the same transaction.
4. NOT_STARTED reminders check that task.status = 'PENDING' before notifying.
5. OVERDUE reminders check that task.status NOT IN ('COMPLETED','CANCELLED') before
   transitioning to OVERDUE.
*/

CREATE OR REPLACE FUNCTION process_due_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_reminder_label text;
BEGIN
  -- No authenticated user
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('processed', 0, 'error', 'no authenticated user');
  END IF;

  FOR v_reminder IN
    SELECT tr.id, tr.task_id, tr.reminder_type, tr.reminder_time, tr.is_sent
    FROM task_reminders tr
    INNER JOIN tasks t ON t.id = tr.task_id
    WHERE tr.is_sent = false
      AND tr.reminder_time <= v_now
      AND t.user_id = v_user_id
    ORDER BY tr.reminder_time ASC
    FOR UPDATE OF tr SKIP LOCKED
  LOOP
    -- Lock the task row
    SELECT * INTO v_task FROM tasks WHERE id = v_reminder.task_id FOR UPDATE;

    -- Skip if task was deleted
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_should_notify := true;
    v_notification_title := '';
    v_notification_message := '';
    v_reminder_label := '';

    -- Build notification based on reminder type
    CASE v_reminder.reminder_type
      WHEN 'ONE_DAY' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 day.';
        v_reminder_label := '1 day before';

      WHEN 'TWO_HOURS' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 2 hours.';
        v_reminder_label := '2 hours before';

      WHEN 'ONE_HOUR' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 1 hour.';
        v_reminder_label := '1 hour before';

      WHEN 'THIRTY_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 30 minutes.';
        v_reminder_label := '30 minutes before';

      WHEN 'FIFTEEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 15 minutes.';
        v_reminder_label := '15 minutes before';

      WHEN 'TEN_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 10 minutes.';
        v_reminder_label := '10 minutes before';

      WHEN 'FIVE_MINUTES' THEN
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" starts in 5 minutes.';
        v_reminder_label := '5 minutes before';

      WHEN 'AT_START' THEN
        v_notification_title := 'Task starting now';
        v_notification_message := 'It''s time to start: ' || v_task.title || '.';
        v_reminder_label := 'at start';
        -- Transition PENDING -> IN_PROGRESS
        IF v_task.status = 'PENDING' THEN
          UPDATE tasks SET status = 'IN_PROGRESS', updated_at = v_now WHERE id = v_task.id;
        END IF;

      WHEN 'NOT_STARTED' THEN
        v_notification_title := 'Task not started';
        v_notification_message := 'You haven''t started your task yet: ' || v_task.title || '.';
        v_reminder_label := 'not started check';
        -- Only notify if task is still PENDING
        IF v_task.status != 'PENDING' THEN
          v_should_notify := false;
        END IF;

      WHEN 'OVERDUE' THEN
        v_notification_title := 'Task overdue';
        v_notification_message := 'Your task "' || v_task.title || '" was scheduled to finish but is not completed.';
        v_reminder_label := 'overdue check';
        -- Only notify/transition if not completed/cancelled
        IF v_task.status NOT IN ('COMPLETED', 'CANCELLED') THEN
          UPDATE tasks SET status = 'OVERDUE', updated_at = v_now WHERE id = v_task.id;
        ELSE
          v_should_notify := false;
        END IF;

      ELSE
        -- CUSTOM or unknown
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" is coming up.';
        v_reminder_label := 'reminder';
    END CASE;

    -- Create notification if appropriate
    IF v_should_notify THEN
      INSERT INTO notifications (user_id, task_id, title, message, type, is_read)
      VALUES (v_task.user_id, v_task.id, v_notification_title, v_notification_message, 'IN_APP', false);
    END IF;

    -- Mark reminder as sent (always, even if we didn't notify — prevents reprocessing)
    UPDATE task_reminders
    SET is_sent = true, sent_at = v_now
    WHERE id = v_reminder.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'timestamp', v_now);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION process_due_reminders() TO authenticated;
