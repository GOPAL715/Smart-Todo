/*
# Create process_all_due_reminders RPC for server-side scheduler

## Overview
Creates a SECURITY DEFINER PL/pgSQL function that processes ALL due reminders
for ALL users. This is called by the server-side edge function (process-reminders)
using the service role key. Unlike process_due_reminders() which is scoped to
auth.uid(), this function processes every user's due reminders.

## How it works
Same logic as process_due_reminders() but without the auth.uid() filter:
1. Finds all unsent reminders where reminder_time <= now()
2. Uses FOR UPDATE SKIP LOCKED for concurrency safety
3. Creates notifications and transitions task statuses
4. Marks reminders as sent

## Security
- SECURITY DEFINER with search_path = public
- NO grants to anon or authenticated — only callable with service role key
- The edge function passes the service role key to authenticate
*/

CREATE OR REPLACE FUNCTION process_all_due_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    FROM task_reminders tr
    INNER JOIN tasks t ON t.id = tr.task_id
    WHERE tr.is_sent = false
      AND tr.reminder_time <= v_now
    ORDER BY tr.reminder_time ASC
    FOR UPDATE OF tr SKIP LOCKED
  LOOP
    SELECT * INTO v_task FROM tasks WHERE id = v_reminder.task_id FOR UPDATE;

    IF NOT FOUND THEN
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
          UPDATE tasks SET status = 'IN_PROGRESS', updated_at = v_now WHERE id = v_task.id;
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
          UPDATE tasks SET status = 'OVERDUE', updated_at = v_now WHERE id = v_task.id;
        ELSE
          v_should_notify := false;
        END IF;

      ELSE
        v_notification_title := 'Task reminder';
        v_notification_message := 'Your task "' || v_task.title || '" is coming up.';
    END CASE;

    IF v_should_notify THEN
      INSERT INTO notifications (user_id, task_id, title, message, type, is_read)
      VALUES (v_task.user_id, v_task.id, v_notification_title, v_notification_message, 'IN_APP', false);
    END IF;

    UPDATE task_reminders
    SET is_sent = true, sent_at = v_now
    WHERE id = v_reminder.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'timestamp', v_now);
END;
$$;

-- No grants to anon or authenticated — only service role can call this
REVOKE EXECUTE ON FUNCTION process_all_due_reminders() FROM PUBLIC, anon, authenticated;
