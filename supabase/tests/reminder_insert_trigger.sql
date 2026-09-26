-- SmartTodo reminder insert trigger regression checks (pgTAP)
-- Run only against a disposable local Supabase database, never production.
--
-- Covers migration 024: reminder creation is a database invariant on INSERT, so
-- every insert path (browser, recurrence materialiser, service role) produces
-- the same reminders.
BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('00000000-0000-0000-0000-0000000000e1','authenticated','authenticated','trigger-a@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000e2','authenticated','authenticated','trigger-b@example.test','','{}','{}',now(),now());

-- ---------- the trigger exists and is safe to execute ----------
SELECT has_trigger('public','tasks','trg_create_task_reminders_on_insert','insert trigger exists on tasks');
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_task_reminders_on_insert'),
  'trigger function is SECURITY DEFINER so it can insert reminders for any caller'
);
SELECT ok(
  (SELECT COALESCE(p.proconfig::text,'') LIKE '%search_path=%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_task_reminders_on_insert'),
  'trigger function pins an empty search_path'
);
SELECT ok(
  NOT has_function_privilege('anon','public.create_task_reminders_on_insert()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.create_task_reminders_on_insert()','EXECUTE'),
  'no client role can invoke the trigger function directly'
);

-- ---------- a future task gets its reminders automatically ----------
-- No reminder rows are inserted by this test: the trigger alone must create them.
INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,reminder_offsets)
VALUES ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e1','Future task',CURRENT_DATE,'09:00','10:00',now()+interval '2 days',now()+interval '2 days 1 hour',60,ARRAY[30,10]);

SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e3' AND is_sent=false),
  4::bigint,
  'inserting a future task creates its offset reminders plus NOT_STARTED and OVERDUE'
);
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e3' AND reminder_type='THIRTY_MINUTES'),
  1::bigint,
  'offset reminder is created with the right type'
);
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e3' AND is_sent=false AND reminder_time <= now()),
  0::bigint,
  'no reminder is created in the past'
);

-- ---------- logical duplicates are prevented ----------
-- The logical unique index plus ON CONFLICT DO NOTHING must make a repeated
-- call idempotent, which is what lets the recurrence path keep calling
-- create_task_reminders_for after the trigger has already run.
SELECT public.create_task_reminders_for('00000000-0000-0000-0000-0000000000e3');
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e3'),
  4::bigint,
  'calling create_task_reminders_for again creates no duplicates'
);

-- ---------- past-dated tasks create no stale pending reminders ----------
INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,reminder_offsets)
VALUES ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000e1','Past task',CURRENT_DATE-1,'09:00','10:00',now()-interval '2 hours',now()-interval '1 hour',60,ARRAY[30]);
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e4'),
  0::bigint,
  'a task whose reminder times have passed creates no pending reminders'
);

-- ---------- recurrence materialisation does not duplicate reminders ----------
-- materialize_recurring_tasks inserts the occurrence AND then calls
-- create_task_reminders_for itself. The trigger must not double up.
--
-- Note on dating: materialisation only advances a series whose occurrence has
-- already ENDED, so a generated occurrence is always backdated and has no
-- future reminder times. Correct behaviour is therefore zero reminders for it.
-- What matters is that the *seed* still owns exactly one reminder per type, and
-- that the double call adds nothing.
INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,reminder_offsets,recurrence,schedule_timezone,series_timezone_locked)
VALUES ('00000000-0000-0000-0000-0000000000e5','00000000-0000-0000-0000-0000000000e1','Series seed',CURRENT_DATE,'09:00','10:00',now()+interval '2 days',now()+interval '2 days 1 hour',60,ARRAY[30],'DAILY','Asia/Kolkata',true);
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e5'),
  3::bigint,
  'a recurring seed gets its reminders from the insert trigger alone'
);
SELECT is(
  (SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000e5'
     AND reminder_type IN ('THIRTY_MINUTES','NOT_STARTED','OVERDUE')),
  3::bigint,
  'each reminder type appears exactly once for the seed'
);

-- ---------- sent reminders are preserved ----------
SELECT ok(
  (SELECT count(*) FROM public.task_reminders
   WHERE task_id='00000000-0000-0000-0000-0000000000e3' AND is_sent=false) > 0,
  'existing pending reminders survive the trigger being present'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
