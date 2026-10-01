# Smart Todo Task Management — Production Operations Runbook

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

---

## 2a. Automated health monitoring

> **Status: implemented, not yet armed.** The workflow is committed, but it
> stays red until the `DATABASE_URL` secret below is added. Until then,
> alerting is still manual.

### What runs

A scheduled GitHub Actions workflow, `SmartTodo Production Health`
(`.github/workflows/health-monitor.yml`), runs the same
`supabase/ops/health_check.sql` above against production every **15 minutes**
and converts its rows into a pass/fail exit code. It is read-only: it changes no
data, dispatches nothing, and reschedules nothing.

The workflow is deliberately separate from `SmartTodo CI`. That one validates
changes on pull requests; this one watches production. Merging them would mean
a commit could fail because production was already unhealthy.

### What counts as a failure

`supabase/ops/health_check_gate.mjs` applies one rule: **only `FAIL` fails the
gate.**

| Gate outcome | Meaning |
|---|---|
| `PASS` | every check healthy (warnings may still be listed) |
| `FAIL` | at least one check is `FAIL`, **or** no results could be parsed |

Two deliberate choices:

- **`WARN` does not fail.** The scheduler fires every minute, so a run that is
  2–5 minutes old is ordinary jitter, not an outage. Failing on it would train
  everyone to ignore the alert. Warnings are still printed.
- **Unparseable output fails.** If the SQL errors, or is edited into a shape
  that returns nothing, the gate reports `FAIL` rather than passing. A check
  that goes quiet because it broke must never look identical to a healthy one.

### Where the alert goes

The GitHub Actions notification for a failed run — email to repository watchers
by default, plus the run's log. No external monitoring vendor is configured, and
none is added: GitHub is the platform already in use.

To get SMS as well, enable **Settings -> Notifications -> SMS** on the account
and add `alert: failure` to the job. No repository code changes.

### Required configuration (the one manual step)

Add a repository secret named **`DATABASE_URL`**:

**Settings -> Secrets and variables -> Actions -> New repository secret.**

Its value is the **Supabase pooler** connection string:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Find it in **Supabase Dashboard -> Connect**. Use the **pooler** connection
(port `5432`, `aws-0-…pooler.supabase.com`), not the direct one: it goes through
the Supavisor proxy and therefore works from a hosted runner. The direct address
(`db.<ref>.supabase.co`) is IP-restricted and will be refused from GitHub.

Until this secret exists the workflow fails immediately with a clear
`::error::` naming it, rather than silently skipping. That failure is expected,
not a bug, until the secret is added.

To confirm it is armed afterwards, run it by hand:
**Actions -> SmartTodo Production Health -> Run workflow.**

### Verifying it locally

No database is needed to test the gate itself:

```bash
# healthy input -> exit 0
node supabase/ops/health_check_gate.mjs "db|PASS|connected
recent_runs|PASS|1 run(s)"

# a failing check -> exit 1
node supabase/ops/health_check_gate.mjs "recent_runs|FAIL|no run in the last 5 minutes"

# unparseable input -> exit 1 (fails closed)
node supabase/ops/health_check_gate.mjs "psql: error: connection failed"
```

Against a real database, exactly as CI runs it:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -t -A -F '|' \
  -f supabase/ops/health_check.sql | \
  node supabase/ops/health_check_gate.mjs "$(cat)"
```

### Investigating a failure

1. Open the failed run's log — the summary names each failing check.
2. Work that check using the spot checks below and section 4 (recovery).
3. Transient versus persistent: a single failure with a healthy
   `recent_runs` a few minutes later was a blip. If `recent_runs` is still
   `FAIL`, the scheduler is genuinely stopped — go to section 4.1.

### Rotating or revoking the credential

The credential is the **database password** for the `postgres.<project-ref>`
role.

- **Rotate:** change the password in Supabase (**Project Settings -> Database ->
  Reset database password**), update the `DATABASE_URL` secret, then re-run the
  workflow manually. Nothing reads the old value, so there is no ordering
  requirement beyond doing both.
- **Revoke:** remove the `DATABASE_URL` secret. The workflow then fails fast
  with a configuration error and no longer reaches production at all.

The secret is written only to the step environment. It is never echoed, and
`health_check_gate.mjs` additionally redacts anything credential-shaped from a
check's detail before it is printed, so a future change to the SQL cannot leak a
credential into a retained CI log.

---

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
| `SUPABASE_URL` | edge function | no |
| `SUPABASE_SERVICE_ROLE_KEY` | edge function | **yes** |
| Vault `process_reminders_scheduler_token` | database only | **yes** |

The **anon** key is safe in the browser: it is protected by RLS. The
**service-role** key bypasses RLS and must never reach a browser, a `VITE_*`
variable, or a committed file.

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