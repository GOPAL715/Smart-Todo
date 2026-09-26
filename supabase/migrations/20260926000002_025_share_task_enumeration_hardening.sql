/*
# Harden share_task against account enumeration (P1-7, response level)

1. Problem
   Phase 11C collapsed the enumeration-sensitive failure reasons in the UI, but
   the database response was still distinguishable. `share_task` returned:

     { "shared": false, "reason": "not_found" }   -- no such account
     { "shared": false, "reason": "self" }        -- address is the caller

   An authenticated caller who owns any single task could submit an arbitrary
   address and read the JSON response, learning whether that address belongs to
   a registered account. The response also disclosed `updated: true` for an
   already-shared target and the target's display `recipient` name on success,
   both of which are existence signals: repeating a share reveals
   `updated: true` only for an address that exists, and a non-empty recipient
   name is itself proof of an account.

2. Change - response shape only
   Every outcome that depends on the *target account* now returns one identical
   success-shaped object:

     { "shared": true, "updated": false, "recipient": "", "permission": <perm> }

   That covers all four previously distinguishable cases: unknown address, own
   address, already-shared target, and a genuinely new share. `updated` is
   pinned to false and `recipient` to the empty string, so no field carries
   information about the target. The keys are retained with constant values, so
   the existing client (`toResult` in `shareService.ts`) keeps working
   unchanged and no application change is required.

   The user-visible consequence is intentional and is the accepted cost of the
   fix: a share attempt on an unregistered address is reported to the owner the
   same way a real share is. This is the standard trade-off for preventing
   enumeration and is strictly better than publishing account existence. The
   owner's own share list (`list_task_shares`) still shows real recipients, so
   the true outcome remains visible through that list.

3. Responses deliberately left specific
   These are kept because they reveal nothing about any *other* account, and the
   client relies on them for authorization and input validation:

     not_authenticated  - no session
     invalid_permission - caller sent a permission that is not VIEW/EDIT
     invalid_email      - caller sent a blank address
     not_owner          - caller does not own the task

   Critically, the ownership check still runs *before* the account lookup, so
   `not_owner` is returned without ever touching `auth.users` for the supplied
   address. That ordering is preserved exactly.

4. Authorization is unchanged
   The function keeps its exact signature, `SECURITY DEFINER`, and
   `SET search_path = ''` with fully schema-qualified references. It is still
   revoked from `PUBLIC` and `anon` and granted only to `authenticated`. The
   owner check, the permission allowlist, the self-share guard, the update-on-
   already-shared behaviour, the single notification per new share, and all RLS
   policies are untouched. No write is performed for an address that resolves to
   no account, to the caller, or when the caller is not the owner.

5. Notes
   1. Idempotent: `CREATE OR REPLACE` with an identical signature, followed by
      the same REVOKE/GRANT statements.
   2. No error text is ever returned; the function returns a reason code, never
      a provider message.
   3. Timing is deliberately not equalised. That is pre-existing behaviour, and
      adding padding to mask it would introduce new timing-dependent logic.
*/

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
  v_task_title text;
  v_existing boolean := false;
BEGIN
  -- Request-level validation. None of these depend on whether the supplied
  -- address belongs to an account, so they stay specific.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'not_authenticated');
  END IF;

  IF v_perm NOT IN ('VIEW', 'EDIT') THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'invalid_permission');
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'invalid_email');
  END IF;

  -- Authorization. Deliberately runs BEFORE the account lookup so a non-owner
  -- learns nothing about the address.
  SELECT t.title INTO v_task_title
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('shared', false, 'reason', 'not_owner');
  END IF;

  -- Target-dependent outcomes. Every branch below returns the SAME object, so
  -- the response carries no information about the target.

  -- No matching account: reported as success, without writing anything.
  SELECT u.id INTO v_target
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'shared', true, 'updated', false, 'recipient', '', 'permission', v_perm
    );
  END IF;

  -- Caller's own address: self-share protection, reported identically.
  IF v_target = v_uid THEN
    RETURN jsonb_build_object(
      'shared', true, 'updated', false, 'recipient', '', 'permission', v_perm
    );
  END IF;

  SELECT true INTO v_existing
  FROM public.task_shares s
  WHERE s.task_id = p_task_id AND s.shared_with = v_target;

  -- Already shared: the permission is genuinely updated, but the response is
  -- identical to every other target-dependent outcome.
  IF v_existing THEN
    UPDATE public.task_shares
    SET permission = v_perm
    WHERE task_id = p_task_id AND shared_with = v_target;

    RETURN jsonb_build_object(
      'shared', true, 'updated', false, 'recipient', '', 'permission', v_perm
    );
  END IF;

  -- New share: row and one notification are created as before.
  INSERT INTO public.task_shares (task_id, shared_with, shared_by, permission)
  VALUES (p_task_id, v_target, v_uid, v_perm);

  INSERT INTO public.notifications (user_id, task_id, title, message, type, is_read)
  VALUES (
    v_target, p_task_id, 'Task shared with you',
    'A task was shared with you: "' || v_task_title || '".',
    'IN_APP', false
  );

  RETURN jsonb_build_object(
    'shared', true, 'updated', false, 'recipient', '', 'permission', v_perm
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_task(uuid, text, text) TO authenticated;
