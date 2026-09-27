# SmartTodo — Smart Task Reminder

A production-quality todo application with intelligent time-based task reminders. Never miss a task again — the system automatically notifies you at the right time before, during, and after your scheduled tasks.

## Features

- **User Authentication** — Sign up, login, logout, and password reset via emailed recovery link
- **Task Management** — Full CRUD: create, view, edit, delete, start, complete, cancel tasks
- **Pagination** — Task list and notification centre load a page at a time with a visible "showing X of Y" total and Load more, so a large account never silently stops at a row cap
- **Recurring Tasks** — Daily, weekly or monthly tasks; the next occurrence is generated automatically on the server, with its own reminders, when the current one ends
- **Task Sharing** — Share a task with another user by email, as view-only or can-edit; the recipient sees it in their lists and is notified once
- **Smart Reminders** — Configurable reminders (1 day, 2 hours, 1 hour, 30 min, 15 min, 10 min, 5 min, at start)
- **Automatic Status Transitions** — PENDING → IN_PROGRESS → COMPLETED / OVERDUE
- **Not-Started Detection** — Notifies you if a task hasn't been started 10 minutes after its start time
- **Overdue Detection** — Automatically marks tasks overdue when end time passes
- **Notification Center** — In-app notifications with unread count, mark as read, mark all as read, delete
- **Task Priorities** — LOW / MEDIUM / HIGH / URGENT with colour-coded badges wherever tasks appear
- **Tags** — Create tags inline while writing a task, attach many tags per task, filter by tag, and see them on cards and detail views
- **Subtasks** — Ordered checklist per task with a live completion progress bar on the detail page
- **Dashboard** — Greeting, today's tasks, upcoming tasks, overdue tasks, statistics, plus a Productivity panel (Today / This week / This month) showing completed tasks, completion rate, overdue count and average time-to-complete — computed over your own tasks in your timezone
- **Task List** — Filter by status, priority, category or tag; search by title; sort by due date, priority, title or recency; tabbed views (all, today, upcoming, completed, overdue, shared)
- **Calendar** — Monthly calendar with priority-coloured task indicators; click a date to see all tasks for that day at timezone-correct times
- **Task Details** — Full task view with subtasks, tags, reminders, actions, and metadata
- **Timezone Handling** — All times stored as UTC (timestamptz); displayed in user timezone (default: Asia/Kolkata)
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Dark Mode** — Light, dark, and system-following themes; persists across sessions
- **PWA** — Installable as a standalone app with a precached app shell; authenticated API data is not runtime-cached

## Architecture

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, React Router, TanStack Query, vite-plugin-pwa |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions) |
| Database | PostgreSQL with Row Level Security (RLS) |
| Auth | Supabase Auth (JWT, email/password, BCrypt-hashed passwords) |
| Scheduling | pg_cron + pg_net + edge function (server-side, every minute) |
| Icons | lucide-react |
| Date/Time | date-fns + date-fns-tz |

### Project Structure

```
src/
├── components/ui/       # Reusable UI components (TaskCard, ShareTaskPanel)
├── pages/               # Page components (Dashboard, TaskList, TaskForm, TaskDetail, Calendar, Settings, SmartTask, Login, Signup, ForgotPassword, ResetPassword)
├── layouts/             # Layout components (AppLayout with sidebar + notifications + offline banner)
├── hooks/               # Custom hooks (useAuth, useTheme, useReminderProcessor, useOnlineStatus, useUserTimezone, useDismissable, usePagedCollection)
├── services/            # Service layer (supabase client, taskService, tagService, subtaskService, notificationService, shareService, profileService, passwordResetService, queryKeys)
├── types/               # TypeScript type definitions
├── utils/               # Utilities (dateTime, timezone conversion, dashboard analytics, PWA cache, batching, pagination, appError, notificationPanel, taskIntelligence, passwordPolicy)
└── routes/              # Route guards (ProtectedRoute)
```

Database and operations assets live outside `src/`:

```
supabase/
├── migrations/          # Ordered, immutable SQL migrations (001-026)
├── functions/           # Edge functions (process-reminders)
├── tests/               # pgTAP suites; run only against a disposable local database
└── ops/                 # Health check and operations runbook
```

### Database Schema

#### profiles
- `id` (uuid, PK, references auth.users)
- `name`, `email`, `created_at`, `updated_at`

#### tasks
- `id`, `user_id`, `title`, `description`
- `task_date` (date), `start_time`, `end_time` (HH:mm)
- `start_datetime`, `end_datetime` (timestamptz, UTC)
- `duration_minutes`, `priority` (LOW/MEDIUM/HIGH/URGENT)
- `category`, `status` (PENDING/IN_PROGRESS/COMPLETED/OVERDUE/CANCELLED)
- `reminder_offsets` (integer[] — minutes before start)
- `recurrence` (DAILY/WEEKLY/MONTHLY, NULL for one-off tasks)
- `recurrence_until` (date — optional last day the series may generate)
- `series_id` (uuid — identifies one recurring series across its occurrences)
- `created_at`, `updated_at`

#### tags
- `id`, `user_id`, `name`, `created_at` — one row per user-defined tag; unique (`user_id`, `name`)

#### task_tags
- `task_id`, `tag_id`, `created_at` — join table; unique (`task_id`, `tag_id`)

#### subtasks
- `id`, `task_id`, `title`, `is_completed`, `position`, `created_at`, `updated_at` — removed with the parent task (ON DELETE CASCADE)

#### task_reminders
- `id`, `task_id`, `reminder_type`, `reminder_time` (timestamptz)
- `is_sent` (boolean), `sent_at`, `created_at`

#### reminder_scheduler_runs
- `id`, `request_id`, `fired_at`, `note` — one row per scheduled invocation, for health checks
- Pruned to the last 30 days by `public.cleanup_reminder_scheduler_runs()` (migration 026), in 10,000-row batches, on the existing dispatch path — no extra cron job

#### notifications
- `id`, `user_id`, `task_id`, `title`, `message`
- `type` (IN_APP), `is_read`, `created_at`, `read_at`

### Indexes
- `task_reminders(reminder_time, is_sent)` — scheduler query
- `tasks(user_id, task_date)` — dashboard/calendar
- `tasks(status)`, `tasks(user_id, status)` — status filtering
- `notifications(user_id, is_read, created_at)` — notification center
- `tags(user_id)`, `task_tags(task_id)`, `task_tags(tag_id)`, `subtasks(task_id, position)` — tag and subtask lookups

## Reminder & Scheduler Architecture

### Reminder Calculation
When a task is created, the system calculates reminder times based on the task's start time and user-selected offsets:

1. User selects reminder offsets (e.g., 60 min, 30 min, 10 min, 0 min)
2. Frontend calculates `reminder_time = start_datetime - offset` for each
3. Two automatic reminders are added:
   - **NOT_STARTED**: fires 10 minutes after start time (only if task is still PENDING)
   - **OVERDUE**: fires at end time (only if task is not COMPLETED/CANCELLED)

### Server-side scheduler (primary)
Reminders are processed automatically on the server. No browser needs to be open, no
user needs to be signed in, and nothing depends on frontend polling.

| | |
|---|---|
| **Mechanism** | `pg_cron` runs SQL inside the database; that SQL calls `pg_net`, which makes an HTTPS request to the `process-reminders` edge function |
| **Frequency** | Every minute (`* * * * *`) |
| **Endpoint** | `POST https://<project>.supabase.co/functions/v1/process-reminders` |
| **Job name** | `process-reminders-every-minute` (visible in `cron.job`) |
| **Authentication** | `Authorization: Bearer <public project JWT>` satisfies the gateway's JWT verification, and `X-Scheduler-Token: <secret>` carries the real authorisation. The secret is a 256-bit random token generated inside the database and stored in **Vault** (`process_reminders_scheduler_token`). It never reaches the browser |
| **Bypasses RLS?** | The edge function uses the service-role client server-side, the same privileged path used for administrative runs |

**What each tick does**

1. `pg_cron` fires `public.invoke_reminder_processor()` once a minute.
2. That function reads the scheduler token from Vault and POSTs to the endpoint; the
   request id is recorded in `reminder_scheduler_runs`.
3. The edge function checks the token in constant time, then calls
   `process_all_due_reminders()` as the service role.
4. For every due reminder that has not been sent:
   - it checks the task status to decide whether the notification should fire,
   - creates an IN_APP notification with the appropriate message,
   - transitions the task status (PENDING → IN_PROGRESS at start, → OVERDUE at end),
   - marks the reminder `is_sent = true` and sets `sent_at = now()`.

**If an invocation fails**

Failures never lose a reminder. If the network call fails, the function errors, or the
tick is skipped, the affected reminders simply stay `is_sent = false` and are picked up on
a later tick. Every attempt is recorded in `public.reminder_scheduler_runs`, and the raw
HTTP response for each attempt is kept in `net._http_response`, so a missed or failing run
can be diagnosed after the fact. A failed tick delays a reminder; it does not drop it.

For verification and recovery commands, see the operations runbook:
[`supabase/ops/RUNBOOK.md`](supabase/ops/RUNBOOK.md), and run
[`supabase/ops/health_check.sql`](supabase/ops/health_check.sql) for a read-only
PASS/WARN/FAIL health report.

**How idempotency prevents duplicates**

`process_all_due_reminders()` selects only rows where `is_sent = false`, locks them with
`FOR UPDATE SKIP LOCKED`, and sets `is_sent = true` in the same transaction. Two ticks
landing at once cannot both claim the same reminder, and re-running the job after it has
already processed a reminder finds nothing due. Running the scheduler any number of times
produces exactly one notification per reminder.

### Client-side processor (fallback)
The app also calls the user-scoped `process_due_reminders()` RPC while a user has the app
open. This is a convenience only — it processes just that signed-in user's reminders, and
the app works correctly with the browser closed because the server-side scheduler above is
the primary mechanism.

### Notification Messages
- "Your task starts in 1 hour." / "30 minutes." / "10 minutes." etc.
- "It's time to start: [task title]."
- "You haven't started your task yet: [task title]."
- "Your task '[task title]' is overdue."

## Security

Access control is enforced in the database, not in the interface:

- **Row Level Security** is enabled on every table (`profiles`, `tasks`, `task_reminders`,
  `notifications`, `tags`, `task_tags`, `subtasks`) with separate owner-scoped
  SELECT/INSERT/UPDATE/DELETE policies for the `authenticated` role. `task_reminders` is
  scoped through its parent task; `task_tags` and `subtasks` follow the parent task's
  owner-or-EDIT-share rules.
- **Task ownership** — users cannot reach another user's tasks by changing an id
- Task status changes are validated by a `BEFORE UPDATE` trigger
  (`enforce_task_status_transition`), so the workflow cannot be bypassed by calling the
  data API directly.
- **Password hashing** is managed by Supabase Auth (BCrypt)
- `process_all_due_reminders()` (cross-tenant, RLS-bypassing) has no EXECUTE grant to
  `anon` or `authenticated`. It is reachable only through the `process-reminders` edge
  function, which keeps JWT verification on and accepts only two callers: a holder of the
  service-role key, or the in-database scheduler presenting its Vault token. Both are
  compared in constant time. `process_due_reminders()` is user-scoped via `auth.uid()` and
  is the only reminder entry point the app itself calls.
- The scheduler's own functions (`invoke_reminder_processor`, `get_reminder_scheduler_token`,
  `cleanup_reminder_scheduler_runs`) are `SECURITY DEFINER` with EXECUTE revoked from
  PUBLIC, `anon` and `authenticated`, so no client role can trigger a cross-tenant run,
  read the scheduler token, or run retention. That token is generated and stored
  server-side in Vault and is never sent to the browser; only a publishable project key
  accompanies it, and that key is public by design.
- `reminder_scheduler_runs` has RLS enabled with no policies, so it is readable by no
  client role.
- Sharing is closed to email enumeration: `share_task` (migration 025) returns an
  identical success response for unregistered, self, newly shared, and already-shared
  outcomes, so the response body cannot be used to discover which emails have accounts.
- User-facing failures show fixed messages; provider and database error detail goes to
  the browser console only, so sign-in, sign-up, and sharing cannot be used to discover
  which email addresses have accounts.

## API (via Supabase)

### Auth
- `supabase.auth.signUp({ email, password, options: { data: { name } } })`
- `supabase.auth.signInWithPassword({ email, password })`
- `supabase.auth.signOut()`
- `supabase.auth.getSession()` / `onAuthStateChange()`

### Tasks (via Supabase client with RLS)
- `POST /tasks` — create task + reminders
- `GET /tasks` — list tasks (with filters)
- `GET /tasks/{id}` — get single task
- `PUT /tasks/{id}` — update task
- `DELETE /tasks/{id}` — delete task
- `GET /tasks?task_date=eq.{date}` — tasks by date
- Task status updates via `PATCH`-style updates

### Tags (via Supabase client with RLS)
- `GET /tags`, `POST /tags` — list and create user-owned tags, unique name per user
- There is no rename or delete API in this application; a tag is created and then attached to tasks
- `POST /task_tags` / `DELETE /task_tags` — attach/detach (RLS: own task or EDIT share; tag ids the caller cannot access are silently dropped, never errored)

### Subtasks (via Supabase client with RLS)
- `GET/POST /subtasks?task_id=eq.{id}`, `PATCH/DELETE /subtasks/{id}` — ordered checklist items (RLS: own task or EDIT share)

### Notifications (via Supabase client with RLS)
- `GET /notifications` — list notifications
- `PATCH /notifications/{id}` — mark as read
- `PATCH /notifications` (bulk) — mark all as read
- `DELETE /notifications/{id}` — delete notification

### Sharing RPCs
- `share_task(task_id, email, permission)` — owner only; grants view or edit access
- `update_task_share(share_id, permission)` — owner only; changes the access level
- `revoke_task_share(share_id)` — the owner may revoke, the recipient may leave
- `list_task_shares(task_id)` — owner only; who a task is shared with
- `list_share_overview()` — everything the list pages need: tasks shared with the signed-in user, and who the signed-in user has shared their own tasks with

### Task sharing
A task belongs to the user who created it. Its owner can share it with another registered
user by email, granting `VIEW` (read-only) or `EDIT` (read/write) access.

- Sharing is managed only through the RPCs above, each of which re-checks the caller's
  relationship to the task. The `task_shares` table has a read-only policy and no write
  policy, so it cannot be changed directly by any client.
- `user_id` is not an updatable column through the API for anyone, so a shared editor
  cannot reassign ownership of a task to themselves.
- Only the owner can delete a task or change who it is shared with.
- A newly shared user is notified once; changing an existing share's access does not
  notify again.
- Reminder notifications continue to go to the task owner.

### Scheduler RPC
- `supabase.rpc('process_due_reminders')` — process the signed-in user's own due reminders (client fallback)
- `process-reminders` edge function — processes due reminders for every user; server-side only
- `materialize_recurring_tasks()` — generates the next occurrence of each recurring task; scheduler-only

### Recurring tasks
A task with `recurrence` set to `DAILY`, `WEEKLY` or `MONTHLY` continues automatically.
Each scheduled tick, after dispatching reminders, `materialize_recurring_tasks()` finds every
recurring task whose occurrence has ended and which is the newest in its series, then creates
the next occurrence with the same details and a fresh set of reminders.

- Only one occurrence is generated at a time; the following one appears when that one ends.
- A unique index on `(series_id, start_datetime)` plus `FOR UPDATE SKIP LOCKED` makes this
  idempotent — a repeated or overlapping tick cannot create a duplicate occurrence.
- Cancelling an occurrence ends its series. Setting `recurrence_until` stops generation once
  the next date would fall after it.
- Editing a one-off soon enough now also refreshes its pending reminders to match the new
  schedule; already-sent reminders are kept as history.
- Recurrence is DST-safe: the next occurrence's UTC time is computed by interpreting the
  original local time in the task's stored timezone, so a daily 09:00 task stays at 09:00
  across EST/EDT transitions.

### Per-user timezone
Each user's profile stores an IANA timezone (default: Asia/Kolkata). Task date/time input
is interpreted in that zone and converted to UTC for storage. All displayed times are
converted back. The timezone can be changed in Settings without moving existing tasks.

### Dark mode
Three options: Light, Dark, System (follows OS preference). The choice is stored in
localStorage and survives reloads. An inline script in `index.html` applies the theme
before React mounts to prevent a flash of the wrong theme. Tailwind `darkMode: 'class'`
is used; the `dark` class toggles on `<html>`.

### PWA / Offline
The app is installable as a Progressive Web App. A Workbox-generated service worker
(`registerType: 'autoUpdate'`) precaches the static app shell — HTML, JS, CSS and icons
(`globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}']`), with `navigateFallback` to
`/index.html`, so previously installed builds open without a network connection.

What is **not** cached, deliberately:

- **No Supabase API response is runtime-cached.** Auth requests and every non-GET
  request to `*.supabase.co` are `NetworkOnly`, and there is no GET rule for the
  data API at all. Authenticated rows are therefore *not* available offline. This
  was changed from an earlier NetworkFirst scheme because a shared Workbox cache
  holding bearer-authenticated responses can serve one account's data to another.
- **No background sync and no offline writes.** Nothing is queued for later
  delivery; a request that cannot reach the network simply fails.
- Google Fonts are `CacheFirst` (static assets only).

While offline the app shows a banner, the unread-count poll is suspended, and
**creating** a task is blocked by a disabled submit button. Other screens still
attempt their request and surface a normal error.

Signed-out transitions and session expiry clear the authenticated caches, so one
account's cached responses cannot be shown to the next.

### Password reset
Password reset uses the standard Supabase Auth recovery flow.

1. `/forgot-password` — the user enters an email and the app calls
   `supabase.auth.resetPasswordForEmail(email, { redirectTo })`, where `redirectTo`
   is always `<current origin>/reset-password`. It is derived from the app's own
   origin and a fixed route; the user cannot supply it, so the recovery link
   cannot be aimed elsewhere.
2. The same neutral confirmation is shown whether or not the address is registered
   ("If an account exists for this email, you'll receive a password reset link."),
   so the page cannot be used to discover which addresses have accounts.
3. Following the emailed link lands on `/reset-password`. Supabase exchanges the
   recovery token for a real session and the app records that it arrived via
   `PASSWORD_RECOVERY`; the app never parses the link's tokens itself.
4. The new password and its confirmation are submitted to
   `supabase.auth.updateUser({ password })`, which Supabase refuses without a valid
   session. The page applies the same policy as sign-up — at least 8 characters
   with mixed case, a number and a symbol — and shows the same strength meter.
5. If the link is invalid, expired or already used there is no session, so the
   form is never rendered and the user is offered a new link.

Required dashboard configuration (**Supabase → Authentication → URL Configuration**):
the Site URL plus `https://<your-frontend-host>/reset-password` and
`http://localhost:5173/reset-password` under **Redirect URLs**. The same
placeholder, rate-limit and leaked-password protections that apply to sign-up
also apply here.

### Automated health monitoring
`supabase/ops/health_check.sql` is read-only and safe against production. A
GitHub Actions workflow, **SmartTodo Production Health**
(`.github/workflows/health-monitor.yml`), runs it on a **15-minute schedule** and
can also be started by hand from the Actions tab.

- Only a `FAIL` row fails the run. `WARN` is reported but non-fatal, because the
  scheduler fires every minute and a 2–5 minute gap is normal jitter.
- Output that cannot be parsed fails **closed**, so a broken check never reads as
  a healthy one.
- The alert is the ordinary GitHub Actions failed-run notification. Whether that
  reaches anyone by email depends on the repository's notification settings; no
  external monitoring vendor is configured.

> **Not currently armed.** The workflow requires a `DATABASE_URL` repository
> secret (the Supabase **pooler** connection string) that has not been added. Until
> it is, the scheduled run fails with a configuration error and no production
> health signal is actually being produced. See
> [the runbook](supabase/ops/RUNBOOK.md#2a-automated-health-monitoring) for the
> exact setup and the manual procedure.

## Local Setup

1. The Supabase backend is provisioned separately. Copy `.env.example` to `.env` and fill in
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Supabase → Project Settings → API**.
   `.env` is gitignored; the browser only ever receives the publishable (anon) key.
2. Install dependencies. `npm ci` installs exactly what `package-lock.json` pins and
   is what CI uses, so it is the reproducible choice:
   ```bash
   npm ci
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```
5. Type check:
   ```bash
   npm run typecheck
   ```
6. Run unit tests (Vitest):
   ```bash
   npm test
   ```
7. Lint:
   ```bash
   npm run lint
   ```

### Quality gates
Every change is validated on pull requests and on every push to `main` by the
**SmartTodo CI** workflow, which fails the build on any non-zero exit:

| Gate | Command |
|---|---|
| Unit tests (Vitest) | `npm test` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` |
| Database tests (pgTAP) | run in a disposable local database, never production |

The pgTAP suites in `supabase/tests/` (6 suites, 86 assertions) run in CI against a
**disposable local database** created per run and destroyed afterwards. They are never
pointed at production. See
[`supabase/ops/RUNBOOK.md`](supabase/ops/RUNBOOK.md#7-pgtap-database-tests).

## Environment Variables

Only two variables are required, and both are browser-safe:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The service-role key and the scheduler token are **never** browser variables. See
[Operations runbook](supabase/ops/RUNBOOK.md#6-configuration-and-secrets).

### Required manual configuration

Password strength is enforced by the hosted Supabase Auth settings, not by this
repository. In the Supabase dashboard under **Authentication → Providers → Email**:

1. Raise the **minimum password length** from the default 6 to at least 10 characters.
2. Enable **leaked password protection** (HaveIBeenPwned check) so credentials known to
   be breached are rejected at sign-up and password change.

## Completed Features (all phases)

- Core task management with full CRUD, status transitions, priorities (including URGENT), and categories
- Phase 10 — Productivity Intelligence Foundation: user tags (create inline, attach/detach, filter by tag), subtasks with a live progress bar, multi-criteria task-list sorting, timezone-aware dashboard productivity analytics (own tasks only — shared tasks never skew personal stats), priority-coloured calendar indicators, and Vitest unit tests for the date/time utilities
- Smart in-app reminders with configurable offsets (1 day through at-start)
- Server-side pg_cron scheduler processing reminders every minute with duplicate protection
- Task recurrence (daily, weekly, monthly) with DST-safe next-occurrence generation
- Task sharing with view-only and can-edit permissions
- Per-user timezone selection affecting all task input and display
- Dark mode with light/dark/system options and localStorage persistence
- PWA with a precached app shell, public asset caching, and an online/offline indicator (no API caching)
- Phase 11A — Security/reliability hardening: auth cache isolation, per-user query-key
  scoping, and hardened reminder creation
- Phase 11B — Calendar performance and error handling: one bounded range query per month
  instead of 35–42 per-day calls, plus visible error states
- Phase 11C — Sharing security and accessibility: `share_task` no longer reveals whether
  an email is registered (migration 025), and icon controls, dialogs, and the mobile
  drawer gained accessible names, focus return, and Escape handling
- Phase 11D — Performance and timezone correctness: exact lifetime dashboard statistics
  counted in Postgres, range-bounded analytics, timezone-anchored calendar, and bounded
  task/tag queries
- Phase 11E — Operations: 30-day retention for scheduler run history (migration 026, no
  extra cron job), a read-only [health check](supabase/ops/health_check.sql), and an
  [operations runbook](supabase/ops/RUNBOOK.md)
- Phases 12–14 — Timezone profile synchronisation, an automated CI quality gate
  (Vitest, typecheck, lint, build, plus the pgTAP database suites in a disposable
  local database), a password-reset flow, and a hardened Edge Function CORS policy
  that removed a wildcard origin
- Phase 15 — Pagination: the task list and notification centre load a page at a
  time and report an exact total, replacing silent 500/100-row truncation
- Phase 16 — Route code splitting: six secondary page chunks load on demand while
  the shell, auth screens and dashboard stay in the initial bundle
- Phases 18–20 — Notification-panel accessibility (correct non-modal semantics,
  focus management, Escape and focus restoration), a single user-facing error
  taxonomy, and per-page batched tag lookups that stop re-sending ids already loaded

## Blocked

- **Email/PUSH/SMS notification channels** — the notification abstraction (`type` column) is
  ready for additional channels, but actual delivery requires external provider credentials
  (e.g., SendGrid for email, Twilio for SMS, Firebase Cloud Messaging for push). These are
  not provisioned in this project.
