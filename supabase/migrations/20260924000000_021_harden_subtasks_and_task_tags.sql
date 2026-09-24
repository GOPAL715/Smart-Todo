/*
# Phase 10 hardening: subtask VIEW reads + tag ownership on task_tags

Source: Phase 10 pre-production security review (fixes applied AFTER 020).

## FIX 1 — VIEW collaborators may read subtasks
`020`'s `select_subtasks` required owner OR 'EDIT', so a VIEW collaborator
could read the parent task (014 `select_tasks_shared_with_me`) but not its
subtasks — inconsistent with 014/015 and with `select_task_tags`
(which already admits permission IN ('VIEW','EDIT')).

The SELECT policy is recreated using the same task-sharing EXISTS pattern
as 014/015. New visibility matrix for public.subtasks:

  Owner                : SELECT / INSERT / UPDATE / DELETE  allowed
  'EDIT' collaborator  : SELECT / INSERT / UPDATE / DELETE  allowed
  'VIEW' collaborator  : SELECT allowed; INSERT / UPDATE / DELETE DENIED

No write policy is touched, so VIEW write access stays default-deny.

## FIX 2 — task_tags writes require tag ownership
`020`'s `insert_task_tags` / `update_task_tags` WITH CHECK validated only
the task side, allowing a user who had learned another user's tag id
(tag ids are visible on shared tasks via `select_task_tags`) to attach
that foreign tag to a task they can modify (cross-user association).

Both write policies now additionally require the referenced tag row to
belong to auth.uid(), evaluated through the same EXISTS pattern:

  1. caller may modify the task relationship (owner or 'EDIT' share) AND
  2. tags.id = task_tags.tag_id AND tags.user_id = auth.uid()

`select_task_tags` (READ) and all `tags` owner-only policies are unchanged,
so tag names remain visible only to their owner — nothing is exposed to
collaborators beyond what 020 already allowed (tag ids on readable tasks).

The subquery against public.tags is recursion-safe: `select_own_tags`
compares only auth.uid() = user_id and reads no other table (same
termination argument as 014's task_shares policy).

## Scope
- Policy statements only: no tables, columns, constraints, indexes,
  functions, triggers, or grants are created or altered.
- Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY.
- Migration 020 is NOT modified (migrations are immutable here).
*/

-- ==================== FIX 1: subtasks SELECT admits VIEW ====================
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
              AND s.permission IN ('VIEW', 'EDIT')
          ))
    )
  );

-- ==================== FIX 2: task_tags writes require owned tag ====================
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
    AND EXISTS (
      SELECT 1 FROM public.tags g
      WHERE g.id = task_tags.tag_id
        AND g.user_id = auth.uid()
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
    AND EXISTS (
      SELECT 1 FROM public.tags g
      WHERE g.id = task_tags.tag_id
        AND g.user_id = auth.uid()
    )
  );
