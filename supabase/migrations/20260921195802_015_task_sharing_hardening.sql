/*
# Task sharing: close an ownership-transfer hole and expose per-task access

1. Context
   `014_task_sharing.sql` introduced the sharing model (`task_shares` plus the
   `share_task`, `update_task_share`, `revoke_task_share`, `list_task_shares` and
   `list_share_overview` functions). This migration does not rebuild any of it —
   it fixes one defect and adds one read helper.

2. Defect fixed — ownership transfer by a collaborator
   `update_tasks_shared_with_me` allowed a recipient with EDIT to update a task
   row, and its WITH CHECK re-checked only that the caller still held an EDIT
   share. It did not constrain `user_id`, so a collaborator could set `user_id`
   to their own id and take the task.
   In practice this was already unreachable through the API because 014 revoked
   the `user_id` column from `UPDATE` for `anon` and `authenticated`, but the
   policy itself still permitted the row shape. The WITH CHECK now also requires
   the row's `user_id` to equal the `shared_by` recorded on the granting share
   row, so the rule holds at the policy level and does not depend on the column
   grants alone. `update_own_tasks` is unchanged.

3. Addition — `get_task_access(p_task_id)`
   Returns the caller's relationship to a task as a small jsonb object:
   `{ ok, is_owner, is_shared, permission }`. This lets a caller resolve its own
   access to a single task without loading the whole sharing overview. The
   shipped UI currently derives access from `list_share_overview`, so this is a
   supporting helper rather than a required dependency of the screens.

4. Security notes
   1. Actor is always `auth.uid()`; no parameter names the caller.
   2. `get_task_access` discloses nothing beyond the caller's own permission.
   3. No policy is widened, no existing function is replaced, `task_shares` keeps
      SELECT-only client grants, and the reminder scheduler, recurrence and
      `task_reminders` are untouched.
   4. Idempotent: DROP POLICY IF EXISTS before create, CREATE OR REPLACE for the
      function, IF NOT EXISTS for indexes.
*/

-- ==================== FIX: collaborators cannot take ownership ====================
DROP POLICY IF EXISTS "update_tasks_shared_with_me" ON public.tasks;
CREATE POLICY "update_tasks_shared_with_me" ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_shares s
      WHERE s.task_id = tasks.id
        AND s.shared_with = auth.uid()
        AND s.permission = 'EDIT'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_shares s
      WHERE s.task_id = tasks.id
        AND s.shared_with = auth.uid()
        AND s.permission = 'EDIT'
        AND s.shared_by = tasks.user_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_task_shares_shared_with ON public.task_shares(shared_with);
CREATE INDEX IF NOT EXISTS idx_task_shares_shared_by ON public.task_shares(shared_by);

-- ==================== ADD: per-task access for the current user ====================
CREATE OR REPLACE FUNCTION public.get_task_access(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_permission text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.user_id INTO v_owner FROM public.tasks t WHERE t.id = p_task_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_owner = v_uid THEN
    RETURN jsonb_build_object('ok', true, 'is_owner', true, 'is_shared', false, 'permission', null);
  END IF;

  SELECT s.permission INTO v_permission
  FROM public.task_shares s
  WHERE s.task_id = p_task_id AND s.shared_with = v_uid;

  IF v_permission IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_permitted');
  END IF;

  RETURN jsonb_build_object('ok', true, 'is_owner', false, 'is_shared', true, 'permission', v_permission);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_task_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_task_access(uuid) TO authenticated;
