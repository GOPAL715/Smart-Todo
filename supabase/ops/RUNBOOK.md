# SmartTodo — Production Operations Runbook

Operational procedures for the reminder scheduler, production verification, and
recovery. Nothing here is required to build or run the app locally.

The scheduler architecture is documented in the main
[README](../README.md#reminder--scheduler-architecture). This runbook covers how
to **operate and verify** it.

---

## 1. How the scheduler works (operational summary)

```
pg_cron  --every minute-->  public.invoke_reminder_processor()
                              |-- reads token from Vault
                              |-- net.http_post  ->  process-reminders edge function
                              |-- INSERT reminder_scheduler_runs (request_id, 'dispatched')
                              `-- retention pass (deletes runs older than 30 days)
                                        |
                                        v
                          process-reminders (edge function)
                              |-- authz: service-role bearer OR Vault scheduler token
                              `-- rpc process_all_due_reminders()
                                    `-- SELECT ... FOR UPDATE SKIP LOCKED
                                        INSERT notification; set is_sent = true
```

Two paths process reminders, and both are safe to run any number of times:

| | Path | Scope |
|---|---|---|
| Primary | pg_cron → pg_net → edge function | every user, no browser needed |
| Fallback | `process_due_reminders()` from the app | the signed-in user only |

---

## 2. Verify scheduler health

Run the ready-made check in the Supabase **SQL Editor**, or with `psql`:

```bash
psql "$DATABASE_URL" -f supabase/ops/health_check.sql
```

It returns one row per check with `PASS` / `WARN` / `FAIL`:

| check | FAIL means |
|---|---|
| `db` | cannot reach the database |
| `cron_job` | the `process-reminders-every-minute` job is missing or inactive |
| `recent_runs` | no dispatch in the last 5 minutes — the scheduler is not running |
| `dispatch_errors` | a row whose `note` is not `dispatched`, e.g. a missing Vault token |
| `pg_net_responses` | an HTTP response in the last hour was not 2xx |
| `scheduler_token` | the Vault token is missing or duplicated |
| `reminder_backlog` | more than 100 unsent reminders are already past due |
| `reminder_uniqueness` | the duplicate-send guard index is missing |
| `retention` | more than ~60k run rows, so retention is not working |

The script exposes **no secrets and no user data**: the scheduler token is only
ever reported as present/absent, and task/notification data only as counts.

### Individual spot checks

```sql
-- is the job present, active, and still every minute?
SELECT jobname, schedule, active, command FROM cron.job
WHERE jobname = 'process-reminders-every-minute';

-- when did it last dispatch?
SELECT fired_at, note FROM public.reminder_scheduler_runs
ORDER BY fired_at DESC LIMIT 5;

-- any dispatch that reported a problem?
SELECT fired_at, note FROM public.reminder_scheduler_runs
WHERE note IS DISTINCT FROM 'dispatched' ORDER BY fired_at DESC LIMIT 10;
```

### Inspecting `pg_net` responses

`pg_net` delivers asynchronously, so a response can be absent for a tick or two
and still be normal. When a dispatch fails, the raw response is kept briefly:

```sql
-- status codes only. Never select content/headers: they carry the token.
SELECT id, status_code, created FROM net._http_response
ORDER BY created DESC LIMIT 10;

-- correlate a specific run to its HTTP outcome
SELECT r.fired_at, r.request_id, h.status_code
FROM public.reminder_scheduler_runs r
LEFT JOIN net._http_response h ON h.id = r.request_id
WHERE r.fired_at > now() - interval '30 minutes'
ORDER BY r.fired_at DESC;
```

> `net._http_response` is truncated by pg_net itself after a short window. The
> durable audit trail is `reminder_scheduler_runs`, not the HTTP table.


---

## 3. Diagnose reminder delivery failures

Work down this list; each step is read-only.

1. **Is the scheduler alive?** `recent_runs` in the health check. If the last run
   is minutes old, the problem is upstream of reminders entirely.
2. **Did the dispatch reach the function?** `pg_net_responses`. A non-2xx with
   `401` means authorization failed — see §4. A `500` means the function ran and
   the RPC failed; read the function's logs in the Supabase dashboard.
3. **Is the token present?** `scheduler_token`. A missing token makes
   `invoke_reminder_processor()` raise before it dispatches, and the failing run
   is recorded with `note = 'scheduler token missing from vault'`.
4. **Is work being claimed?** `reminder_backlog`. A growing backlog with a healthy
   scheduler usually means the RPC is erroring; check the function logs.
5. **Are the rows actually due?** A reminder is only processed when
   `is_sent = false` **and** `reminder_time <= now()`:

```sql
SELECT id, task_id, reminder_type, reminder_time, is_sent
FROM public.task_reminders
WHERE is_sent = false AND reminder_time < now()
ORDER BY reminder_time LIMIT 20;
```

6. **Is the task still eligible?** Cancelled and completed tasks deliberately
   produce **no** notification; the reminder is still consumed so it is not
   retried forever. That is correct behaviour, not a failure.

---

## 4. Recovery procedures

### The scheduler stopped ticking

```sql
-- unschedule, then re-create with the same definition
SELECT cron.unschedule('process-reminders-every-minute');
SELECT cron.schedule(
  'process-reminders-every-minute',
  '* * * * *',
  $$SELECT public.invoke_reminder_processor();$$
);
```

Alternatively redeploy the relevant migration, which performs this
unschedule / re-create sequence idempotently. Confirm recovery with the
health check.

### The scheduler token is missing or was rotated

The function raises and every tick records
`note = 'scheduler token missing from vault'`. Recreate it:

```sql
SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'process_reminders_scheduler_token',
  'Bearer token presented by the pg_cron job to the process-reminders edge function'
);
```

There is nothing to redeploy: the edge function reads the token from Vault on
every request, so the next tick authenticates. Do not paste the generated value
anywhere.

### A dispatch is returning 401

`401` means the edge function rejected the caller. Either the token in Vault no
longer matches (see above), or the `Authorization` header no longer carries a
valid project JWT. Both are defined in
`supabase/migrations/20260926000003_026_scheduler_run_retention.sql`; update the
function and re-apply that migration.

### The Edge Function is undeployed

```bash
supabase functions deploy process-reminders
```

The function needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; both are
provided automatically by the platform and must **not** be set manually in a
browser-visible variable.

---

## 5. Migration status

```bash
# local vs remote, and any pending migrations
npx supabase@2.117.0 migration list --linked

# applied migrations (SQL Editor)
SELECT version, name, inserted_at::date
FROM supabase_migrations.schema_migrations ORDER BY version;
```

> `migration list --linked` requires `supabase login` first. Without an access
> token it prompts interactively and cannot run unattended.

Migrations are applied in filename order and are individually idempotent, so
re-applying the most recent one is a safe way to confirm state. Never run
`supabase db reset` against production.

### Retention (migration 026)

`reminder_scheduler_runs` is pruned to **30 days**, in batches of 10,000 rows per
pass, inside the existing dispatch function. No additional cron job was created.

- ~43,200 rows retained at steady state.
- A retention failure only raises a `WARNING`; it can never fail a dispatch.
- To tighten or widen the window, call it explicitly:
  `SELECT public.cleanup_reminder_scheduler_runs(interval '60 days');`
  Sub-day windows are refused, so a bad argument can never wipe the table.

---

## 6. Configuration and secrets

### Required environment variables

| Variable | Where | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | browser build | no |
| `VITE_SUPABASE_ANON_KEY` | browser build | no — publishable by design |
| `VITE_AI_TASK_PROVIDER` | browser build | no — selects a feature only |
| `SUPABASE_URL` | edge function | no |
| `SUPABASE_SERVICE_ROLE_KEY` | edge function | **yes** |
| Vault `process_reminders_scheduler_token` | database only | **yes** |
| `OPENAI_API_KEY` | `parse-task-with-ai` only | **yes** |
| `OPENAI_MODEL` | `parse-task-with-ai` only | no |

The **anon** key is safe in the browser: it is protected by RLS. The
**service-role** key bypasses RLS and must never reach a browser, a `VITE_*`
variable, or a committed file.

### AI task parsing (`parse-task-with-ai`)

This function interprets a natural-language description into a *draft*. It
cannot create, modify or delete any task, and it deliberately does **not** use
the service-role key: the caller is authenticated with the **anon** key and
their own session token, so RLS and user identity behave exactly as they do for
the rest of the app. Saving remains the browser's job through `createTask`.

Server-side variables (set with `supabase secrets set`, never in a `.env` file):

- `OPENAI_API_KEY` — **required** for the AI path. Without it the function
  returns 503 and the app silently falls back to the on-device parser.
- `OPENAI_MODEL` — optional. Defaults to `gpt-4o-mini`, a small cost-sensitive
  model that is sufficient for this tightly-scoped structured extraction. Raise
  it only if extraction quality proves inadequate; a larger model costs more per
  call and is not needed for a schema-constrained output.

Frontend variable (safe, because it carries no credential):

- `VITE_AI_TASK_PROVIDER=openai` — adds the "Generate with AI" button. Any
  other or absent value keeps the deterministic parser, so existing users are
  never billed for AI they did not opt into.

**Never** place `OPENAI_API_KEY` in a `.env` file, a `VITE_*` variable, or any
committed file. A `VITE_` variable is inlined into the browser bundle at build
time and is therefore public.

### Never commit

- `.env` / any `.env.*` holding real values (`.env.example` is the committed template)
- the service-role key, the scheduler token, or any Vault secret
- database connection strings

`.env` is already in `.gitignore`. The publishable anon JWT embedded in the
scheduler migration is intentional and is not a secret — it already ships in the
browser bundle and only satisfies gateway verification; the Vault token remains
the real credential.

---

## 7. pgTAP database tests

The SQL suites in `supabase/tests/` run against a **disposable local database
only** — never production. They are wrapped in `BEGIN`/`ROLLBACK`.

```bash
# apply migrations, then run a suite
psql "$LOCAL_DB_URL" -f supabase/migrations/20260926000003_026_scheduler_run_retention.sql
psql "$LOCAL_DB_URL" -f supabase/tests/scheduler_retention.sql

# expected output ends with: "Looks like you planned 15 tests but ran 15."
```

| Suite | Covers |
|---|---|
| `scheduler_retention.sql` | 30-day retention, batching, idempotency, RLS, grants |
| `reminder_lifecycle.sql` | cancellation, rescheduling, timezone locking |
| `production_audit.sql` | audit hardening and integrity constraints |
| `rls_integration.sql` | RLS across all tables |
| `share_task_enumeration.sql` | Phase 11C share enumeration hardening |
| `reminder_insert_trigger.sql` | migration 024 trigger behaviour |

> If `pg_cron` is live in the test database, the real scheduler ticks during the
> run. `scheduler_retention.sql` therefore scopes every assertion to its own
> fixture rows so a concurrent tick cannot change the result.

### Missed reminders

No recovery is needed. A reminder is only consumed when it is actually
processed, so a scheduler outage delays notifications; it never drops them. Once
the scheduler is healthy again, the backlog drains automatically.