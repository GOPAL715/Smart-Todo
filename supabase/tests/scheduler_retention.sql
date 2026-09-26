-- SmartTodo scheduler run retention regression checks (pgTAP)
-- Run only against a disposable local Supabase database, never production.
--
-- Covers migration 026: the retention function must delete only rows older than
-- the cutoff, must be bounded per pass, must be idempotent, and must not be
-- reachable by any client role.
--
-- DETERMINISM: the retention function is exercised directly, and every fixture
-- is scoped by a unique `note` so a concurrently ticking scheduler cannot change
-- what any assertion counts. `cron.unschedule` is deliberately NOT used here:
-- pg_cron operates outside the test transaction, so an unschedule inside BEGIN
-- would be rolled back with the rest of the transaction and would not actually
-- stop the job.
BEGIN;
SELECT plan(15);

-- ---------- index exists so retention never sequentially scans ----------
-- The index assertion targets the retention index by name, and is written as a
-- plain catalog lookup so it does not depend on pgTAP's schema-qualification
-- behaviour for `has_index`, which differs between pgTAP versions.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'reminder_scheduler_runs'
      AND indexname = 'idx_reminder_scheduler_runs_fired_at'
  ),
  'retention timestamp column is indexed'
);

-- ---------- fixture: rows on both sides of the 30-day cutoff ----------
-- Only rows strictly older than 30 days may be removed by the default call, so
-- the "inside the window" fixtures are kept comfortably inside it.
INSERT INTO public.reminder_scheduler_runs (request_id, fired_at, note) VALUES
  (900001, now() - interval '60 days', 'expired-60'),
  (900002, now() - interval '31 days', 'expired-31'),
  (900003, now() - interval '30 days  +1 hour', 'expired-30'),
  (900004, now() - interval '20 days', 'inside-20'),
  (900005, now() - interval '2 hours', 'inside-2h'),
  (900006, now() - interval '1 minute', 'inside-1m'),
  (900007, now(),                    'current');

-- ---------- default retention removes only the expired rows ----------
SELECT public.cleanup_reminder_scheduler_runs();
SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs WHERE note LIKE 'expired-%'),
  0::bigint,
  'default 30 day retention removes all rows past the cutoff'
);

-- ---------- recent operational history is never deleted ----------
SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs WHERE note LIKE 'inside-%' OR note='current'),
  4::bigint,
  'retention preserves every row inside the retention window'
);

SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs WHERE note='current'),
  1::bigint,
  'a run fired this instant is retained'
);

-- ---------- idempotency: a second pass is a no-op ----------
SELECT is(
  public.cleanup_reminder_scheduler_runs(),
  0::integer,
  'retention is idempotent when nothing has aged out'
);

-- ---------- an explicit window is honoured exactly ----------
-- A 10-day window removes everything strictly older than 10 days. That includes
-- the `inside-20` fixture from the default pass, so exactly one row is expected
-- to go. `expiring-soon` sits at exactly 10 days and is NOT older than the
-- cutoff, so it must survive; `keep-for-now` is well inside the window.
INSERT INTO public.reminder_scheduler_runs (request_id, fired_at, note) VALUES
  (900008, now() - interval '10 days', 'expiring-soon'),
  (900009, now() - interval '9 days',  'keep-for-now');

SELECT is(
  public.cleanup_reminder_scheduler_runs(interval '10 days'),
  1::integer,
  'explicit window deletes exactly the rows older than that window'
);
SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs WHERE note='keep-for-now'),
  1::bigint,
  'a row inside an explicit window survives'
);
SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs WHERE note='expiring-soon'),
  1::bigint,
  'a row exactly at the cutoff is not older than the cutoff, so it survives'
);

-- ---------- a dangerous window is refused rather than wiping the table ----------
SELECT is(
  public.cleanup_reminder_scheduler_runs(interval '1 hour'),
  0::integer,
  'sub-day retention window is refused'
);
-- Scoped to this test's own fixtures. The table is not assumed to be empty: the
-- real scheduler may already have written `dispatched` rows, so the assertion
-- counts only the notes this file creates.
--
-- Surviving rows are inside-1m, inside-2h, current, expiring-soon and
-- keep-for-now. `inside-20` and the `expired-*` fixtures are already gone from
-- the two earlier passes, and `expiring-soon` proves the refused call deleted
-- nothing because it is older than one hour yet still present.
SELECT is(
  (SELECT count(*) FROM public.reminder_scheduler_runs
     WHERE note IN ('inside-1m','inside-2h','current','expiring-soon','keep-for-now')),
  5::bigint,
  'refused retention deleted nothing from this test''s fixtures'
);

-- ---------- the batch bound caps a single pass ----------
-- Ten thousand is the documented batch size, so seed well past it and confirm
-- one pass removes at most that many rows.
INSERT INTO public.reminder_scheduler_runs (request_id, fired_at, note)
SELECT 800000 + g, now() - interval '40 days', 'batch' FROM generate_series(1, 10500) AS g;
SELECT ok(
  public.cleanup_reminder_scheduler_runs() <= 10000,
  'a single retention pass deletes at most one batch (10000 rows)'
);

-- ---------- no client role can run retention ----------
SELECT is(has_function_privilege('anon','public.cleanup_reminder_scheduler_runs(pg_catalog.interval)','EXECUTE'),false,
  'anonymous role cannot run retention');
SELECT is(has_function_privilege('authenticated','public.cleanup_reminder_scheduler_runs(pg_catalog.interval)','EXECUTE'),false,
  'authenticated role cannot run retention');

-- ---------- the audit table is unreadable from any client role ----------
-- RLS is enabled with no policies, so every client read returns zero rows. The
-- table-level SELECT grant that Supabase issues by default is therefore
-- harmless: RLS, not the grant, is what denies access. Asserting the grant is
-- absent would be incorrect, because the default grant does exist.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reminder_scheduler_runs'),
  'RLS is enabled on the scheduler run audit table'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE tablename = 'reminder_scheduler_runs'),
  0::integer,
  'no RLS policy exposes scheduler runs to any role'
);


ROLLBACK;
