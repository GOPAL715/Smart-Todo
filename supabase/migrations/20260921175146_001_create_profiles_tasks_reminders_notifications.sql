/*
# Create core tables: profiles, tasks, task_reminders, notifications

## Overview
Creates the four core tables for the SmartTodo application:
- `profiles` — user display info extending auth.users
- `tasks` — user tasks with date/time, priority, status
- `task_reminders` — calculated reminder times per task
- `notifications` — in-app notification center

## Tables

### profiles
- `id` uuid PK, references auth.users ON DELETE CASCADE
- `name` text, user's display name
- `email` text, user's email
- `created_at`, `updated_at` timestamptz

### tasks
- `id` uuid PK
- `user_id` uuid NOT NULL DEFAULT auth.uid(), references auth.users ON DELETE CASCADE
- `title` text NOT NULL
- `description` text
- `task_date` date NOT NULL (the calendar date of the task)
- `start_time` text NOT NULL (HH:mm local format)
- `end_time` text NOT NULL (HH:mm local format)
- `start_datetime` timestamptz NOT NULL (UTC start)
- `end_datetime` timestamptz NOT NULL (UTC end)
- `duration_minutes` integer NOT NULL
- `priority` text NOT NULL DEFAULT 'MEDIUM' (LOW/MEDIUM/HIGH)
- `category` text
- `status` text NOT NULL DEFAULT 'PENDING' (PENDING/IN_PROGRESS/COMPLETED/OVERDUE/CANCELLED)
- `reminder_offsets` integer[] NOT NULL DEFAULT '{}' (minutes before start)
- `created_at`, `updated_at` timestamptz

### task_reminders
- `id` uuid PK
- `task_id` uuid NOT NULL, references tasks ON DELETE CASCADE
- `reminder_type` text NOT NULL (ONE_DAY/TWO_HOURS/ONE_HOUR/THIRTY_MINUTES/FIFTEEN_MINUTES/TEN_MINUTES/FIVE_MINUTES/AT_START/NOT_STARTED/OVERDUE/CUSTOM)
- `reminder_time` timestamptz NOT NULL (calculated UTC time to fire)
- `is_sent` boolean NOT NULL DEFAULT false
- `sent_at` timestamptz
- `created_at` timestamptz

### notifications
- `id` uuid PK
- `user_id` uuid NOT NULL DEFAULT auth.uid(), references auth.users ON DELETE CASCADE
- `task_id` uuid, references tasks ON DELETE SET NULL
- `title` text NOT NULL
- `message` text NOT NULL
- `type` text NOT NULL DEFAULT 'IN_APP'
- `is_read` boolean NOT NULL DEFAULT false
- `created_at` timestamptz
- `read_at` timestamptz

## Indexes
- task_reminders(reminder_time, is_sent) — scheduler query
- tasks(user_id, task_date) — dashboard/calendar queries
- tasks(status) — status filtering
- tasks(user_id, status) — combined user+status queries
- notifications(user_id, is_read, created_at) — notification center
- notifications(user_id, is_read) — unread count

## Security (RLS)
All tables have RLS enabled with owner-scoped policies for authenticated users.
task_reminders is accessed via the parent task's user_id (no direct user_id column).
notifications has its own user_id column for direct ownership checks.

## Notes
1. All owner columns default to auth.uid() so inserts omitting user_id succeed.
2. task_reminders has no user_id — it's scoped through the parent task.
3. Email confirmation is OFF (Supabase default).
4. Timestamps stored as timestamptz (UTC) for safe timezone handling.
*/

-- ==================== PROFILES ====================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ==================== TASKS ====================
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  task_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  category text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED')),
  reminder_offsets integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tasks" ON tasks;
CREATE POLICY "select_own_tasks" ON tasks FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_tasks" ON tasks;
CREATE POLICY "insert_own_tasks" ON tasks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_tasks" ON tasks;
CREATE POLICY "update_own_tasks" ON tasks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_tasks" ON tasks;
CREATE POLICY "delete_own_tasks" ON tasks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_start_datetime ON tasks(start_datetime);

-- ==================== TASK_REMINDERS ====================
CREATE TABLE IF NOT EXISTS task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('ONE_DAY','TWO_HOURS','ONE_HOUR','THIRTY_MINUTES','FIFTEEN_MINUTES','TEN_MINUTES','FIVE_MINUTES','AT_START','NOT_STARTED','OVERDUE','CUSTOM')),
  reminder_time timestamptz NOT NULL,
  is_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_reminders ENABLE ROW LEVEL SECURITY;

-- task_reminders has no user_id; scoped through parent task
DROP POLICY IF EXISTS "select_own_reminders" ON task_reminders;
CREATE POLICY "select_own_reminders" ON task_reminders FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_reminders.task_id AND tasks.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_reminders" ON task_reminders;
CREATE POLICY "insert_own_reminders" ON task_reminders FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_reminders.task_id AND tasks.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_reminders" ON task_reminders;
CREATE POLICY "update_own_reminders" ON task_reminders FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_reminders.task_id AND tasks.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_reminders.task_id AND tasks.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_reminders" ON task_reminders;
CREATE POLICY "delete_own_reminders" ON task_reminders FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_reminders.task_id AND tasks.user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_reminders_time_sent ON task_reminders(reminder_time, is_sent);
CREATE INDEX IF NOT EXISTS idx_reminders_task ON task_reminders(task_id);

-- ==================== NOTIFICATIONS ====================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'IN_APP' CHECK (type IN ('IN_APP','EMAIL','PUSH','SMS')),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
