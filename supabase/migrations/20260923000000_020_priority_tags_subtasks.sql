/*
# Phase 10: Task Priority (URGENT), Tags, and Subtasks

## 1. Priority Extension
Extends the existing `priority` CHECK constraint from ('LOW','MEDIUM','HIGH')
to include 'URGENT'. Existing tasks keep their current value (MEDIUM default).

## 2. Tags
Normalized tag system. Each tag belongs to one user. Tasks can have many tags.
- `tags` table: id, user_id, name, created_at
- `task_tags` table: task_id, tag_id, created_at
- Unique constraint on (user_id, name) for tag names
- Unique constraint on (task_id, tag_id) to prevent duplicates

## 3. Subtasks
- `subtasks` table: id, task_id, title, is_completed, position, created_at, updated_at
- Foreign key to tasks ON DELETE CASCADE

## 4. Indexes
- tags(user_id) for user-scoped queries
- task_tags(task_id) for task tag lookups
- task_tags(tag_id) for tag task lookups
- subtasks(task_id, position) for ordered subtask display

## 5. Security
RLS enabled on all new tables. Policies:
- tags: owner-only access (user_id = auth.uid())
- task_tags: user can manage tags on tasks they own or have EDIT access to
- subtasks: access inherited from parent task via owner or EDIT permission

All tables use SECURITY INVOKER functions where needed.
*/

-- ==================== EXTEND PRIORITY CHECK ====================
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_priority_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));

-- Update existing tasks to keep their current values (no data migration needed).

-- ==================== TAGS ====================
CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_unique_name_per_user UNIQUE (user_id, name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tags" ON public.tags;
CREATE POLICY "select_own_tags" ON public.tags FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_tags" ON public.tags;
CREATE POLICY "insert_own_tags" ON public.tags FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_tags" ON public.tags;
CREATE POLICY "update_own_tags" ON public.tags FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_tags" ON public.tags;
CREATE POLICY "delete_own_tags" ON public.tags FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tags_user ON public.tags(user_id);

-- ==================== TASK_TAGS ====================
CREATE TABLE IF NOT EXISTS public.task_tags (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_tags_unique UNIQUE (task_id, tag_id)
);

ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;

-- Access through parent task ownership or EDIT permission
DROP POLICY IF EXISTS "select_task_tags" ON public.task_tags;
CREATE POLICY "select_task_tags" ON public.task_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission IN ('VIEW', 'EDIT')
          ))
    )
  );

DROP POLICY IF EXISTS "insert_task_tags" ON public.task_tags;
CREATE POLICY "insert_task_tags" ON public.task_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

DROP POLICY IF EXISTS "update_task_tags" ON public.task_tags;
CREATE POLICY "update_task_tags" ON public.task_tags FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

DROP POLICY IF EXISTS "delete_task_tags" ON public.task_tags;
CREATE POLICY "delete_task_tags" ON public.task_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_tags.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

CREATE INDEX IF NOT EXISTS idx_task_tags_task ON public.task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON public.task_tags(tag_id);

-- ==================== SUBTASKS ====================
CREATE TABLE IF NOT EXISTS public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

-- Access inherited from parent task (owner or EDIT collaborator)
DROP POLICY IF EXISTS "select_subtasks" ON public.subtasks;
CREATE POLICY "select_subtasks" ON public.subtasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = subtasks.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

DROP POLICY IF EXISTS "insert_subtasks" ON public.subtasks;
CREATE POLICY "insert_subtasks" ON public.subtasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = subtasks.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

DROP POLICY IF EXISTS "update_subtasks" ON public.subtasks;
CREATE POLICY "update_subtasks" ON public.subtasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = subtasks.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = subtasks.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

DROP POLICY IF EXISTS "delete_subtasks" ON public.subtasks;
CREATE POLICY "delete_subtasks" ON public.subtasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = subtasks.task_id
        AND (t.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_shares s
            WHERE s.task_id = t.id AND s.shared_with = auth.uid()
              AND s.permission = 'EDIT'
          ))
    )
  );

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON public.subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_position ON public.subtasks(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subtasks_completed ON public.subtasks(task_id, is_completed);
