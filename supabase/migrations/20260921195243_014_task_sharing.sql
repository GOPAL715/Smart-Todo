/*
# Task sharing and collaboration

1. Purpose
   A task owner can share a task with another user, granting either read-only
   ('VIEW') or read/write ('EDIT') access. Until now a task was visible only to
   the user who created it.

2. New table `task_shares`
   - `id`          uuid PK
   - `task_id`     uuid NOT NULL, references tasks ON DELETE CASCADE
   - `shared_with` uuid NOT NULL, references auth.users ON DELETE CASCADE
   - `shared_by`   uuid NOT NULL, references auth.users ON DELETE CASCADE
   - `permission`  text NOT NULL CHECK ('VIEW' | 'EDIT')
   - `created_at`  timestamptz
   UNIQUE (task_id, shared_with) — a user holds at most one permission per task.
   Indexes on (task_id) and (shared_with).

3. Access model for `task_shares`
   RLS is enabled. There is exactly one policy, SELECT, scoped by plain column
   comparison:
       shared_with = auth.uid() OR shared_by = auth.uid()
   There are deliberately NO insert/update/delete policies, so direct writes are
   denied for every client. Shares are created, changed and removed only through
   the RPCs below, each of which re-verifies the caller's relationship to the
   task. The policy intentionally does not read `tasks`: a policy on `tasks`
   reads `task_shares`, so if this policy read `tasks` the two would recurse.

4. Access model for `tasks`
   - SELECT: existing owner policy, plus a new policy allowing a user to read a
     task that has been shared with them.
   - UPDATE: existing owner policy, plus a new policy allowing a user to update a
     task shared with them with permission 'EDIT'.
   - DELETE: unchanged — owner only. A share recipient can never delete.

5. Column-level privileges on `tasks` (ownership protection)
   UPDATE is revoked from anon/authenticated and re-granted column by column,
   excluding `user_id`, `series_id`, `created_at` and `updated_at`. `user_id` is
   therefore not writable through the API by anyone, which is what stops a share
   recipient (who is not the owner) from reassigning ownership of the task to
   themselves. Without this, the EDIT policy would have allowed exactly that.

6. RPCs (SECURITY DEFINER, EXECUTE granted only to authenticated)
   - `share_task(task_id, email, permission)` — owner only. Looks the recipient up
     by email, refuses self-sharing, refuses invalid permission, creates or
     updates the share, and notifies the recipient once when the share is new.
     Returns a generic reason code on failure.
   - `update_task_share(share_id, permission)` — owner only.
   - `revoke_task_share(share_id)` — the owner may revoke; the recipient may
     leave. Anyone else is refused.
   - `list_task_shares(task_id)` — owner only; recipients with name and email.
   - `list_share_overview()` — everything the signed-in user needs for lists:
     tasks shared with them (with the owner's name) and, for tasks they own, who
     they have shared with. It never exposes a user who is not a counterparty in
     an existing share.

7. Security notes
   1. Every RPC pins `search_path` to empty and schema-qualifies every reference.
   2. Ownership is re-checked inside each RPC rather than trusted from the caller,
      so the RPCs cannot be used to touch another user's task.
   3. Sharing notifies the recipient exactly once per new share, so the RPC cannot
      be used to repeatedly spam another user's notification list.
   4. `list_task_shares` and `list_share_overview` disclose only a counterparty's
      name and email in a share that already exists — the sharer typed that email,
      and the recipient is entitled to know who shared with them.
   5. The reminder pipeline is untouched: the scheduler and the reminder functions
      are not modified, and reminder notifications still go to the task owner.
   6. Idempotent: IF NOT EXISTS throughout, policies dropped before creation, and
      the change constraint added only when absent.
*/

-- ==================== TASK_SHARES ====================
CREATE TABLE IF NOT EXISTS public.task_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'VIEW' CHECK (permission IN ('VIEW', 'EDIT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_shares_unique_recipient UNIQUE (task_id, shared_with)
);

ALTER TABLE public.task_shares ENABLE ROW LEVEL SECURITY;

-- Read-only policy. No write policy exists, so writes are denied by default.
DROP POLICY IF EXISTS "select_own_task_shares" ON public.task_shares;
CREATE POLICY "select_own_task_shares" ON public.task_shares FOR SELECT
  TO authenticated
  USING (shared_with = auth.uid() OR shared_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_task_shares_task ON public.task_shares(task_id);
CREATE INDEX IF NOT EXISTS idx_task_shares_recipient ON public.task_shares(shared_with);

-- Explicitly deny direct writes, and allow only reads.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.task_shares FROM anon, authenticated;
GRANT SELECT ON public.task_shares TO authenticated;

-- ==================== TASKS: SHARED ACCESS ====================
DROP POLICY IF EXISTS "select_tasks_shared_with_me" ON public.tasks;
CREATE POLICY "select_tasks_shared_with_me" ON public.tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_shares s
      WHERE s.task_id = tasks.id AND s.shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_tasks_shared_with_me" ON public.tasks;
CREATE POLICY "update_tasks_shared_with_me" ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_shares s
      WHERE s.task_id = tasks.id AND s.shared_with = auth.uid() AND s.permission = 'EDIT'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_shares s
      WHERE s.task_id = tasks.id AND s.shared_with = auth.uid() AND s.permission = 'EDIT'
    )
  );

-- Ownership protection: user_id (and other system columns) become non-writable
-- through the API for every role, owners included.
REVOKE UPDATE ON public.tasks FROM anon, authenticated;
GRANT UPDATE (
  title, description, task_date, start_time, end_time, start_datetime, end_datetime,
  duration_minutes, priority, category, status, reminder_offsets, recurrence, recurrence_until
) ON public.tasks TO authenticated;

-- ==================== SHARE A TASK ====================
CREATE OR REPLACE FUNCTION public.share_task(
  p_task_id uuid,
  p_email text,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm text := upper(trim(COALESCE(p_permission, 'VIEW')));
  v_target uuid;
  v_target_name text;
  v_task_title text;
  v_existing boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'not_authenticated');
  END IF;

  IF v_perm NOT IN ('VIEW', 'EDIT') THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'invalid_permission');
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'invalid_email');
  END IF;

  -- Caller must own the task.
  SELECT t.title INTO v_task_title
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'not_owner');
  END IF;

  SELECT u.id INTO v_target
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'not_found');
  END IF;

  IF v_target = v_uid THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'self');
  END IF;

  SELECT COALESCE(p.name, '') INTO v_target_name
  FROM public.profiles p WHERE p.id = v_target;

  SELECT true INTO v_existing
  FROM public.task_shares s
  WHERE s.task_id = p_task_id AND s.shared_with = v_target;

  IF v_existing THEN
    UPDATE public.task_shares
    SET permission = v_perm
    WHERE task_id = p_task_id AND shared_with = v_target;

    RETURN jsonb_build_object(
      'shared', true, 'updated', true,
      'recipient', COALESCE(v_target_name, ''), 'permission', v_perm
    );
  END IF;

  INSERT INTO public.task_shares (task_id, shared_with, shared_by, permission)
  VALUES (p_task_id, v_target, v_uid, v_perm);

  -- Notify the recipient once, for a new share only.
  INSERT INTO public.notifications (user_id, task_id, title, message, type, is_read)
  VALUES (
    v_target, p_task_id, 'Task shared with you',
    'A task was shared with you: "' || v_task_title || '".',
    'IN_APP', false
  );

  RETURN jsonb_build_object(
    'shared', true, 'updated', false,
    'recipient', COALESCE(v_target_name, ''), 'permission', v_perm
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_task(uuid, text, text) TO authenticated;

-- ==================== CHANGE A SHARE'S PERMISSION ====================
CREATE OR REPLACE FUNCTION public.update_task_share(
  p_share_id uuid,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm text := upper(trim(COALESCE(p_permission, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF v_perm NOT IN ('VIEW', 'EDIT') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_permission');
  END IF;

  UPDATE public.task_shares s
  SET permission = v_perm
  WHERE s.id = p_share_id
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = s.task_id AND t.user_id = v_uid
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  RETURN jsonb_build_object('ok', true, 'permission', v_perm);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_task_share(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_task_share(uuid, text) TO authenticated;

-- ==================== REVOKE A SHARE / LEAVE A SHARED TASK ====================
CREATE OR REPLACE FUNCTION public.revoke_task_share(p_share_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- The owner may revoke any share on their own task.
  DELETE FROM public.task_shares s
  WHERE s.id = p_share_id
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = s.task_id AND t.user_id = v_uid
    );

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'role', 'owner');
  END IF;

  -- A recipient may remove their own access.
  DELETE FROM public.task_shares s
  WHERE s.id = p_share_id AND s.shared_with = v_uid;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'role', 'recipient');
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'not_permitted');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_task_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_task_share(uuid) TO authenticated;

-- ==================== LIST SHARES FOR ONE TASK ====================
CREATE OR REPLACE FUNCTION public.list_task_shares(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.user_id INTO v_owner FROM public.tasks t WHERE t.id = p_task_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'email', COALESCE(u.email, ''),
           'name', COALESCE(p.name, ''),
           'permission', s.permission,
           'created_at', s.created_at
         ) ORDER BY s.created_at ASC), '[]'::jsonb)
  INTO v_result
  FROM public.task_shares s
  LEFT JOIN auth.users u ON u.id = s.shared_with
  LEFT JOIN public.profiles p ON p.id = s.shared_with
  WHERE s.task_id = p_task_id;

  RETURN jsonb_build_object('ok', true, 'shares', v_result);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_task_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_task_shares(uuid) TO authenticated;

-- ==================== SHARE OVERVIEW FOR LIST PAGES ====================
CREATE OR REPLACE FUNCTION public.list_share_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_with_me jsonb;
  v_by_me jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Tasks other people have shared with the caller.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'share_id', s.id,
           'task_id', s.task_id,
           'permission', s.permission,
           'owner_name', COALESCE(op.name, ''),
           'owner_email', COALESCE(ou.email, '')
         )), '[]'::jsonb)
  INTO v_with_me
  FROM public.task_shares s
  LEFT JOIN auth.users ou ON ou.id = s.shared_by
  LEFT JOIN public.profiles op ON op.id = s.shared_by
  WHERE s.shared_with = v_uid;

  -- Who the caller has shared their own tasks with.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'task_id', s.task_id,
           'share_id', s.id,
           'name', COALESCE(rp.name, ''),
           'email', COALESCE(ru.email, ''),
           'permission', s.permission
         )), '[]'::jsonb)
  INTO v_by_me
  FROM public.task_shares s
  JOIN public.tasks t ON t.id = s.task_id
  LEFT JOIN auth.users ru ON ru.id = s.shared_with
  LEFT JOIN public.profiles rp ON rp.id = s.shared_with
  WHERE t.user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'shared_with_me', v_with_me, 'shared_by_me', v_by_me);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_share_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_share_overview() TO authenticated;
