# SmartTodo — Smart Task Reminder

A production-quality todo application with intelligent time-based task reminders. Never miss a task again — the system automatically notifies you at the right time before, during, and after your scheduled tasks.

## Features

- **User Authentication** — Sign up, login, logout with secure JWT-based auth
- **Task Management** — Full CRUD: create, view, edit, delete, start, complete, cancel tasks
- **Recurring Tasks** — Daily, weekly or monthly tasks; the next occurrence is generated automatically on the server, with its own reminders, when the current one ends
- **Task Sharing** — Share a task with another user by email, as view-only or can-edit; the recipient sees it in their lists and is notified once
- **Smart Reminders** — Configurable reminders (1 day, 2 hours, 1 hour, 30 min, 15 min, 10 min, 5 min, at start)
- **Automatic Status Transitions** — PENDING → IN_PROGRESS → COMPLETED / OVERDUE
- **Not-Started Detection** — Notifies you if a task hasn't been started 10 minutes after its start time
- **Overdue Detection** — Automatically marks tasks overdue when end time passes
- **Notification Center** — In-app notifications with unread count, mark as read, mark all as read, delete
- **Dashboard** — Greeting, today's tasks, upcoming tasks, overdue tasks, statistics
- **Task List** — Filter by status, priority, category; search by title; tabbed views (all, today, upcoming, completed, overdue)
- **Calendar** — Monthly calendar with task indicators; click a date to see all tasks for that day
- **Task Details** — Full task view with reminders, actions, and metadata
- **Timezone Handling** — All times stored as UTC (timestamptz); displayed in user timezone (default: Asia/Kolkata)
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Dark Mode** — Light, dark, and system-following themes; persists across sessions
- **PWA** — Installable as a standalone app with offline shell and cached data reads

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
├── pages/               # Page components (Dashboard, TaskList, TaskForm, TaskDetail, Calendar, Settings, Login, Signup)
├── layouts/             # Layout components (AppLayout with sidebar + notifications + offline banner)
├── hooks/               # Custom hooks (useAuth, useTheme, useReminderProcessor, useOnlineStatus, useUserTimezone)
├── services/            # Service layer (supabase client, taskService, notificationService, shareService)
├── types/               # TypeScript type definitions
├── utils/               # Utilities (dateTime helpers, timezone conversion, PWA cache management)
└── routes/              # Route guards (ProtectedRoute)
```

### Database Schema

#### profiles
- `id` (uuid, PK, references auth.users)
- `name`, `email`, `created_at`, `updated_at`

#### tasks
- `id`, `user_id`, `title`, `description`
- `task_date` (date), `start_time`, `end_time` (HH:mm)
- `start_datetime`, `end_datetime` (timestamptz, UTC)
- `duration_minutes`, `priority` (LOW/MEDIUM/HIGH)
- `category`, `status` (PENDING/IN_PROGRESS/COMPLETED/OVERDUE/CANCELLED)
- `reminder_offsets` (integer[] — minutes before start)
- `recurrence` (DAILY/WEEKLY/MONTHLY, NULL for one-off tasks)
- `recurrence_until` (date — optional last day the series may generate)
- `series_id` (uuid — identifies one recurring series across its occurrences)
- `created_at`, `updated_at`

#### task_reminders
- `id`, `task_id`, `reminder_type`, `reminder_time` (timestamptz)
- `is_sent` (boolean), `sent_at`, `created_at`

#### reminder_scheduler_runs
- `id`, `request_id`, `fired_at`, `note` — one row per scheduled invocation, for health checks

#### notifications
- `id`, `user_id`, `task_id`, `title`, `message`
- `type` (IN_APP), `is_read`, `created_at`, `read_at`

### Indexes
- `task_reminders(reminder_time, is_sent)` — scheduler query
- `tasks(user_id, task_date)` — dashboard/calendar
- `tasks(status)`, `tasks(user_id, status)` — status filtering
- `notifications(user_id, is_read, created_at)` — notification center

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

- **Row Level Security** on all tables — users can only access their own data
- **Owner-scoped policies** — `auth.uid() = user_id` checks on every operation
- **Task ownership** — users cannot access other users' tasks by changing IDs
- **task_reminders** scoped through parent task's user_id
- **SECURITY DEFINER functions** have EXECUTE revoked from anon role
- **Password hashing** — managed by Supabase Auth (BCrypt)

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
precaches the app shell (HTML, JS, CSS, icons) for offline access. Supabase GET API
calls use NetworkFirst caching (5s timeout, 1-hour TTL) so previously loaded data
remains available offline. Auth endpoints are NetworkOnly. Mutations are disabled
while offline with a clear UI indicator. Runtime caches are cleared on logout to
prevent cross-user data leakage.

## Local Setup

1. The Supabase backend is provisioned automatically — credentials are in `.env`
2. Install dependencies:
   ```bash
   npm install
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

## Environment Variables

All Supabase environment variables are pre-populated:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Security

Access control is enforced in the database, not in the interface:

- Row Level Security is enabled on every table (`profiles`, `tasks`, `task_reminders`,
  `notifications`) with separate owner-scoped SELECT/INSERT/UPDATE/DELETE policies for
  the `authenticated` role. `task_reminders` is scoped through its parent task.
- Task status changes are validated by a `BEFORE UPDATE` trigger
  (`enforce_task_status_transition`), so the workflow cannot be bypassed by calling the
  data API directly.
- `process_all_due_reminders()` (cross-tenant, RLS-bypassing) has no EXECUTE grant to
  `anon` or `authenticated`. It is reachable only through the `process-reminders` edge
  function, which keeps JWT verification on and accepts only two callers: a holder of the
  service-role key, or the in-database scheduler presenting its Vault token. Both are
  compared in constant time. `process_due_reminders()` is user-scoped via `auth.uid()` and
  is the only reminder entry point the app itself calls.
- The scheduler's own functions (`invoke_reminder_processor`, `get_reminder_scheduler_token`)
  are `SECURITY DEFINER` with EXECUTE revoked from PUBLIC, `anon` and `authenticated`, so no
  client role can trigger a cross-tenant run or read the scheduler token. That token is
  generated and stored server-side in Vault and is never sent to the browser; only a
  publishable project key accompanies it, and that key is public by design.
- `reminder_scheduler_runs` has RLS enabled with no policies, so it is readable by no
  client role.
- User-facing failures show fixed messages; provider and database error detail goes to
  the browser console only, so sign-in and sign-up cannot be used to discover which
  email addresses have accounts.

### Required manual configuration

Password strength is enforced by the hosted Supabase Auth settings, not by this
repository. In the Supabase dashboard under **Authentication → Providers → Email**:

1. Raise the **minimum password length** from the default 6 to at least 10 characters.
2. Enable **leaked password protection** (HaveIBeenPwned check) so credentials known to
   be breached are rejected at sign-up and password change.

## Completed Features (all phases)

- Core task management with full CRUD, status transitions, priorities, and categories
- Smart in-app reminders with configurable offsets (1 day through at-start)
- Server-side pg_cron scheduler processing reminders every minute with duplicate protection
- Task recurrence (daily, weekly, monthly) with DST-safe next-occurrence generation
- Task sharing with view-only and can-edit permissions
- Per-user timezone selection affecting all task input and display
- Dark mode with light/dark/system options and localStorage persistence
- PWA with offline shell, cached API reads, and online/offline indicator

## Blocked

- **Email/PUSH/SMS notification channels** — the notification abstraction (`type` column) is
  ready for additional channels, but actual delivery requires external provider credentials
  (e.g., SendGrid for email, Twilio for SMS, Firebase Cloud Messaging for push). These are
  not provisioned in this project.
