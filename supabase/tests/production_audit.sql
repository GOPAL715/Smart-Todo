-- SmartTodo production audit regression checks (pgTAP)
-- Run only against a disposable local Supabase database, never production.
BEGIN;
SELECT plan(12);

SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('handle_new_user','process_due_reminders','process_all_due_reminders') AND p.prosecdef AND COALESCE(p.proconfig::text,'') NOT LIKE '%search_path=%'), 0::bigint, 'security definer search paths are pinned');
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_profiles_updated_at','trg_tasks_updated_at','trg_subtasks_updated_at') AND NOT tgisinternal), 3::bigint, 'updated_at triggers exist');
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname='trg_refresh_task_pending_reminders' AND NOT tgisinternal), 1::bigint, 'pending reminder trigger exists');
SELECT has_function('public','process_due_reminders', 'user reminder RPC exists');
SELECT has_function('public','process_all_due_reminders', 'server reminder RPC exists');
SELECT has_table('public','tasks', 'tasks table exists');
SELECT has_table('public','task_tags', 'task_tags table exists');
SELECT has_table('public','subtasks', 'subtasks table exists');
SELECT has_table('public','task_reminders', 'task_reminders table exists');
SELECT has_table('public','task_shares', 'task_shares table exists');
SELECT ok(NOT has_function_privilege('anon','public.process_all_due_reminders()','EXECUTE'), 'anonymous cannot execute privileged reminder RPC');
SELECT ok(NOT has_function_privilege('anon','public.materialize_recurring_tasks()','EXECUTE'), 'anonymous cannot execute recurrence RPC');

SELECT * FROM finish();
ROLLBACK;
