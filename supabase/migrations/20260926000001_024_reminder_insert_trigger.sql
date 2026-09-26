/*
# Database-owned reminder creation on task insert

1. Problem
   Reminder rows were created in two different places:

   a. The browser, immediately after inserting a task
      (`createRemindersForTask` in `src/services/taskService.ts`).
   b. The database, on UPDATE via `trg_refresh_task_pending_reminders` (023).

   That split leaves a real gap. Any task insert that does not go through the
   browser — the recurrence materialiser, a service-role insert, a migration, a
   future API — gets no reminders at all, permanently and silently. It also
   makes the browser the authoritative source, so a request that succeeds but is
   followed by a network failure leaves a task that will never notify.

2. Change
   Add `trg_create_task_reminders_on_insert`, an `AFTER INSERT ... FOR EACH ROW`
   trigger on `public.tasks` that calls the existing
   `public.create_task_reminders_for(NEW.id)`. Reminder creation is now a
   database invariant covering every insert path, and the browser's own insert
   is no longer authoritative (it has been removed in the same change; see
   `createTask` in `taskService.ts`).

3. Why `create_task_reminders_for` is safe to call from a trigger
   It was inspected rather than assumed:

   - `SECURITY DEFINER`, so it can insert into `task_reminders` regardless of
     the calling role. This is required: `authenticated` has no EXECUTE grant on
     it, so a SECURITY INVOKER trigger firing on a browser insert would fail.
   - `SET search_path = ''` with every object reference schema-qualified
     (`public.tasks`, `public.task_reminders`), so there is no search-path
     resolution to hijack. `now()` and `make_interval()` are in `pg_catalog`,
     which is always resolvable.
   - Returns `integer`, never raises on a missing task, and is already
     `SECURITY DEFINER` in 023.

   No hardening of that function is required, so none is applied here.

4. Idempotency / no duplicates
   Reminder rows are protected by the unique index added in 023,
   `idx_task_reminders_logical_unique (task_id, reminder_type, reminder_time)`,
   and every insert inside the function uses `ON CONFLICT DO NOTHING`.

   This matters because `materialize_recurring_tasks()` (018) inserts an
   occurrence AND then calls `create_task_reminders_for` itself. With this
   trigger the second call is a no-op against the same unique index, so
   recurrence materialisation produces exactly one set of reminders. That
   function is deliberately left untouched.

5. Sent reminders
   The trigger only ever runs on INSERT, so it cannot touch an existing row.
   Already-sent reminders are never modified, and no historical reminder is
   rewritten or deleted.

6. Past-dated tasks
   The function only creates a reminder whose time is still in the future
   (`IF v_reminder_time > now()`), so inserting a task that has already started
   produces no stale pending reminders that would immediately fire.

7. Security
   - No policy, grant, role or RLS setting is changed. Existing owner-scoped
     RLS on `task_reminders` is untouched.
   - The trigger function is `SECURITY DEFINER` with `search_path = ''`, and its
     EXECUTE is revoked from `PUBLIC`, `anon` and `authenticated` so no client
     role can invoke it directly. Triggers still fire, because a trigger
     function executes with the privileges of its own definer (the migration
     role), which retains EXECUTE on `create_task_reminders_for`.
   - pg_cron, the Vault scheduler token, `invoke_reminder_processor()`,
     `get_reminder_scheduler_token()` and the `process-reminders` Edge Function
     are not touched.

8. Idempotent
   The trigger is dropped before creation and the function is
   `CREATE OR REPLACE`, so this migration is safe to re-run.
*/

-- ==================== TRIGGER FUNCTION ====================

CREATE OR REPLACE FUNCTION public.create_task_reminders_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Any failure here aborts the task INSERT. That is the intended behaviour:
  -- a task that cannot be given its reminders should not exist, rather than
  -- exist and silently never notify.
  PERFORM public.create_task_reminders_for(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_task_reminders_on_insert() FROM PUBLIC, anon, authenticated;

-- ==================== TRIGGER ====================

DROP TRIGGER IF EXISTS trg_create_task_reminders_on_insert ON public.tasks;

CREATE TRIGGER trg_create_task_reminders_on_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.create_task_reminders_on_insert();
