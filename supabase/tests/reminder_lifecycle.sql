-- SmartTodo reminder lifecycle regression checks (pgTAP)
-- Run only against a disposable local Supabase database, never production.
BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','reminders-a@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000d2','authenticated','authenticated','reminders-b@example.test','','{}','{}',now(),now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);

INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,reminder_offsets)
VALUES ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000d1','Cancellation task',CURRENT_DATE-1,'09:00','10:00',now()-interval '2 hours',now()-interval '1 hour',60,ARRAY[30]);
INSERT INTO public.task_reminders (id,task_id,reminder_type,reminder_time,is_sent,sent_at)
VALUES
('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000d3','THIRTY_MINUTES',now()+interval '30 minutes',false,NULL),
('00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-0000000000d3','ONE_HOUR',now()-interval '90 minutes',true,now()-interval '90 minutes');

UPDATE public.tasks SET status='CANCELLED' WHERE id='00000000-0000-0000-0000-0000000000d3';
UPDATE public.task_reminders SET reminder_time=now()-interval '1 minute' WHERE id='00000000-0000-0000-0000-0000000000d4';
SELECT public.process_due_reminders();
SELECT is((SELECT count(*) FROM public.notifications WHERE task_id='00000000-0000-0000-0000-0000000000d3'),0::bigint,'cancelled task creates no notification');
SELECT is((SELECT is_sent FROM public.task_reminders WHERE id='00000000-0000-0000-0000-0000000000d4'),true,'due cancelled reminder is consumed without notification');
SELECT is((SELECT is_sent FROM public.task_reminders WHERE id='00000000-0000-0000-0000-0000000000d5'),true,'sent reminder remains historical after cancellation');

UPDATE public.tasks
SET status='PENDING', start_datetime=now()+interval '2 days', end_datetime=now()+interval '2 days 1 hour', reminder_offsets=ARRAY[10]
WHERE id='00000000-0000-0000-0000-0000000000d3';
SELECT is((SELECT count(*) FROM public.task_reminders WHERE task_id='00000000-0000-0000-0000-0000000000d3' AND reminder_type='TEN_MINUTES' AND is_sent=false),1::bigint,'rescheduling active task rebuilds pending reminders');

SELECT throws_ok($$UPDATE public.tasks SET reminder_offsets=ARRAY[45] WHERE id='00000000-0000-0000-0000-0000000000d3'$$,'23514',NULL,'unsupported custom reminder offset is rejected');

INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,schedule_timezone,series_timezone_locked)
VALUES ('00000000-0000-0000-0000-0000000000d6','00000000-0000-0000-0000-0000000000d1','One time state',CURRENT_DATE,'09:00','10:00',now()+interval '1 day',now()+interval '1 day 1 hour',60,'America/New_York',true);
SELECT is((SELECT schedule_timezone IS NULL AND series_timezone_locked = false FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000d6'),true,'one-time task state is normalized');

INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes,recurrence)
VALUES ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000d1','Recurring state',CURRENT_DATE,'09:00','10:00',now()+interval '1 day',now()+interval '1 day 1 hour',60,'DAILY');
SELECT is((SELECT schedule_timezone = 'Asia/Kolkata' AND series_timezone_locked FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000d7'),true,'recurring task state is locked');

RESET ROLE;
SELECT is(has_function_privilege('anon','public.process_all_due_reminders()','EXECUTE'),false,'anonymous privileged RPC is denied');
SELECT * FROM finish();
ROLLBACK;
