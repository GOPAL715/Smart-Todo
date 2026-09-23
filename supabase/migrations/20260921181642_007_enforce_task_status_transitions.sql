/*
# Enforce valid task status transitions in the database

1. Problem
   The client is allowed to update its own tasks, including the `status` column.
   Nothing in the database checked that the new status was a legal next step, so a
   request made directly against the data API could move a task into any status
   from any status (for example marking a cancelled task completed, or moving a
   completed task back to overdue), bypassing the workflow the UI enforces.

2. Changes
   - New function `public.enforce_task_status_transition()` (trigger function,
     SECURITY INVOKER, fixed empty search_path) that validates the status change.
   - New trigger `trg_tasks_status_transition` BEFORE UPDATE ON `tasks`, fired only
     when `status` actually changes.

3. Allowed transitions
   - unchanged status is always allowed (no-op updates, edits to other columns)
   - PENDING      -> IN_PROGRESS | COMPLETED | CANCELLED | OVERDUE
   - IN_PROGRESS  -> COMPLETED | CANCELLED | OVERDUE | PENDING (reopen)
   - OVERDUE      -> COMPLETED | CANCELLED | IN_PROGRESS | PENDING (reopen)
   - COMPLETED    -> PENDING (reopen only)
   - CANCELLED    -> PENDING (restore only)
   Any other change raises an error.

4. Notes
   1. The transitions the application itself performs (start, complete, cancel from
      PENDING/IN_PROGRESS, and the scheduler's PENDING -> IN_PROGRESS and
      -> OVERDUE moves) are all permitted, so existing behaviour is unchanged.
   2. The error message is generic and does not leak internal detail.
   3. Idempotent: function is CREATE OR REPLACE and the trigger is dropped first.
*/

CREATE OR REPLACE FUNCTION public.enforce_task_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'PENDING'     AND NEW.status IN ('IN_PROGRESS','COMPLETED','CANCELLED','OVERDUE'))
  OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED','CANCELLED','OVERDUE','PENDING'))
  OR (OLD.status = 'OVERDUE'     AND NEW.status IN ('COMPLETED','CANCELLED','IN_PROGRESS','PENDING'))
  OR (OLD.status = 'COMPLETED'   AND NEW.status = 'PENDING')
  OR (OLD.status = 'CANCELLED'   AND NEW.status = 'PENDING')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid task status change';
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_status_transition ON public.tasks;

CREATE TRIGGER trg_tasks_status_transition
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.enforce_task_status_transition();
