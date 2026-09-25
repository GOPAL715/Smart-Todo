-- SmartTodo RLS integration checks (pgTAP)
-- Run only against a disposable local Supabase database, never production.
BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','rls-a@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','rls-b@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','rls-c@example.test','','{}','{}',now(),now());
INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes) VALUES
('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','owner task',CURRENT_DATE,'09:00','10:00',date_trunc('day',now())+interval '2 days 3 hours',date_trunc('day',now())+interval '2 days 4 hours',60),
('00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a1','private task',CURRENT_DATE,'09:00','10:00',date_trunc('day',now())+interval '2 days 3 hours',date_trunc('day',now())+interval '2 days 4 hours',60),
('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','user b task',CURRENT_DATE,'09:00','10:00',date_trunc('day',now())+interval '2 days 3 hours',date_trunc('day',now())+interval '2 days 4 hours',60);
INSERT INTO public.subtasks (id,task_id,title) VALUES ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a2','shared subtask');
INSERT INTO public.tags (id,user_id,name) VALUES ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','owner tag'),('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c1','editor tag');
INSERT INTO public.task_tags (task_id,tag_id) VALUES ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3');
INSERT INTO public.task_shares (id,task_id,shared_with,shared_by,permission) VALUES
('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','VIEW'),
('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','EDIT');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),1::bigint,'owner selects own task');
UPDATE public.tasks SET title='owner updated' WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT title FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),'owner updated','owner updates own task');
DELETE FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000b2';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000b2'),1::bigint,'owner cannot delete another task');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a7'),0::bigint,'private task is hidden');
UPDATE public.tasks SET title='must fail' WHERE id='00000000-0000-0000-0000-0000000000a7';
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a7' AND title='must fail'),0::bigint,'private update is denied');
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),1::bigint,'view collaborator reads shared task');
SELECT is((SELECT count(*) FROM public.subtasks WHERE id='00000000-0000-0000-0000-0000000000a4'),1::bigint,'view collaborator reads subtasks');
UPDATE public.tasks SET title='must fail view' WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2' AND title='must fail view'),0::bigint,'view update is denied');
DELETE FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),1::bigint,'view delete is denied');
SELECT throws_ok($$INSERT INTO public.subtasks(task_id,title) VALUES ('00000000-0000-0000-0000-0000000000a2','forbidden')$$,'42501',NULL,'view subtask write is denied');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
UPDATE public.tasks SET title='editor updated' WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT title FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),'editor updated','editor updates shared task');
DELETE FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*) FROM public.tasks WHERE id='00000000-0000-0000-0000-0000000000a2'),1::bigint,'editor cannot delete shared task');
SELECT throws_ok($$UPDATE public.tasks SET user_id='00000000-0000-0000-0000-0000000000c1' WHERE id='00000000-0000-0000-0000-0000000000a2'$$,'42501',NULL,'ownership transfer is denied');
DELETE FROM public.task_tags WHERE task_id='00000000-0000-0000-0000-0000000000a2' AND tag_id='00000000-0000-0000-0000-0000000000a3';
SELECT is((SELECT count(*) FROM public.task_tags WHERE task_id='00000000-0000-0000-0000-0000000000a2' AND tag_id='00000000-0000-0000-0000-0000000000a3'),1::bigint,'editor cannot delete owner tag');
INSERT INTO public.task_tags(task_id,tag_id) VALUES ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c3');
SELECT is((SELECT count(*) FROM public.task_tags WHERE task_id='00000000-0000-0000-0000-0000000000a2' AND tag_id='00000000-0000-0000-0000-0000000000c3'),1::bigint,'editor own tag attach is allowed');
SELECT throws_ok($$INSERT INTO public.task_tags(task_id,tag_id) VALUES ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3')$$,'42501',NULL,'foreign owner tag attach is denied');

RESET ROLE;
SELECT is(has_function_privilege('anon','public.process_all_due_reminders()','EXECUTE'),false,'anonymous privileged RPC is denied');
SELECT * FROM finish();
ROLLBACK;
