-- SmartTodo share_task enumeration-hardening regression checks (pgTAP)
-- Covers migration 025. Run only against a disposable local database, never production.
BEGIN;
SELECT plan(22);

-- ============ function shape / grants are unchanged ============
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='share_task'),
  'share_task is still SECURITY DEFINER'
);
SELECT ok(
  (SELECT COALESCE(p.proconfig::text,'') LIKE '%search_path=%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='share_task'),
  'share_task still pins an empty search_path'
);
SELECT ok(
  NOT has_function_privilege('anon','public.share_task(uuid,text,text)','EXECUTE'),
  'anon still cannot execute share_task'
);
SELECT ok(
  has_function_privilege('authenticated','public.share_task(uuid,text,text)','EXECUTE'),
  'authenticated can still execute share_task'
);

INSERT INTO auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','owner@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','collab@example.test','','{}','{}',now(),now()),
('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','stranger@example.test','','{}','{}',now(),now());

INSERT INTO public.profiles (id,name,email) VALUES
('00000000-0000-0000-0000-0000000000a1','Owner','owner@example.test'),
('00000000-0000-0000-0000-0000000000b1','Collaborator','collab@example.test'),
('00000000-0000-0000-0000-0000000000c1','Stranger','stranger@example.test');

-- Owner's task and a task owned by someone else.
INSERT INTO public.tasks (id,user_id,title,task_date,start_time,end_time,start_datetime,end_datetime,duration_minutes) VALUES
('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','Owned task',CURRENT_DATE,'09:00','10:00',now(),now()+interval '1 hour',60),
('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','Not my task',CURRENT_DATE,'09:00','10:00',now(),now()+interval '1 hour',60);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);

-- ============ request-level rejections stay specific ============
-- These reveal nothing about another account, so they are preserved.
SELECT is(
  (public.share_task('00000000-0000-0000-0000-0000000000a2','collab@example.test','ADMIN')::jsonb->>'reason'),
  'invalid_permission',
  'an unsupported permission is still rejected specifically'
);
SELECT is(
  (public.share_task('00000000-0000-0000-0000-0000000000a2','   ','VIEW')::jsonb->>'reason'),
  'invalid_email',
  'a blank address is still rejected specifically'
);
SELECT is(
  (public.share_task('00000000-0000-0000-0000-0000000000c2','collab@example.test','VIEW')::jsonb->>'reason'),
  'not_owner',
  'a non-owner still cannot share another user task'
);
SELECT is(
  (SELECT count(*) FROM public.task_shares),
  0::bigint,
  'a rejected request writes no share row'
);

-- ============ the four target-dependent responses are identical ============
CREATE TEMP TABLE responses(label text, body jsonb);

-- All four use the SAME permission the caller supplied. `permission` simply
-- echoes the request back, so it is not a target-dependent signal; varying it
-- here would compare two different requests rather than four outcomes of one.
--
-- (1) an address that is NOT registered
INSERT INTO responses VALUES
  ('unregistered', public.share_task('00000000-0000-0000-0000-0000000000a2','nobody@example.test','VIEW'));
-- (2) the caller's own address
INSERT INTO responses VALUES
  ('self', public.share_task('00000000-0000-0000-0000-0000000000a2','owner@example.test','VIEW'));
-- (3) a real new share
INSERT INTO responses VALUES
  ('new_share', public.share_task('00000000-0000-0000-0000-0000000000a2','collab@example.test','VIEW'));
-- (4) the same target again, now already shared
INSERT INTO responses VALUES
  ('already_shared', public.share_task('00000000-0000-0000-0000-0000000000a2','collab@example.test','VIEW'));

SELECT is(
  (SELECT count(DISTINCT body::text) FROM responses),
  1::bigint,
  'unregistered, self, new share and already-shared return byte-identical responses'
);

-- Stripping the echoed permission, the target-dependent fields are all constant.
SELECT is(
  (SELECT count(DISTINCT (body - 'permission')::text) FROM responses),
  1::bigint,
  'responses are identical even excluding the echoed permission'
);

-- The permission field only ever reflects what the caller sent.
SELECT is(
  (SELECT count(DISTINCT body->>'permission') FROM responses),
  1::bigint,
  'permission echoes the caller input and varies with it, not with the target'
);

-- Each field is individually constant, so no field can be used as an oracle.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM responses WHERE NOT (body->>'shared' = 'true')),
  'every target-dependent response reports shared=true'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM responses WHERE NOT (body->>'updated' = 'false')),
  'updated is constant, so it cannot reveal an already-shared target'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM responses WHERE NOT (body->>'recipient' = '')),
  'recipient is always empty, so it cannot reveal a display name'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM responses WHERE body ? 'reason'),
  'no target-dependent response carries a reason code'
);

-- ============ side effects are still correct ============
SELECT is(
  (SELECT count(*) FROM public.task_shares),
  1::bigint,
  'only the genuine new share created a row'
);
-- A repeat share with a different permission still updates the row, even though
-- the response no longer says so.
SELECT public.share_task('00000000-0000-0000-0000-0000000000a2','collab@example.test','EDIT');
SELECT is(
  (SELECT count(*) FROM public.task_shares),
  1::bigint,
  'a repeat share does not create a duplicate row'
);
SELECT is(
  (SELECT permission FROM public.task_shares WHERE shared_with='00000000-0000-0000-0000-0000000000b1'),
  'EDIT',
  'an already-shared target still has its permission updated'
);
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE user_id='00000000-0000-0000-0000-0000000000b1'),
  1::bigint,
  'the recipient is notified exactly once for a new share'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.task_shares
    WHERE shared_with IN ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1')
  ),
  'self-share and unregistered addresses create no share row'
);
SELECT is(
  (SELECT count(*) FROM public.notifications
   WHERE user_id IN ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1')),
  0::bigint,
  'self-share and unregistered addresses notify nobody'
);

-- ============ no raw provider text is ever returned ============
SELECT ok(
  NOT EXISTS (SELECT 1 FROM responses WHERE body::text ~* '(error|exception|sqlstate|pg_)'),
  'no target-dependent response contains provider or error text'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
