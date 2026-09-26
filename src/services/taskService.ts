import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Task, TaskWithRelations, TaskReminder, TaskStatus, TaskPriority, Recurrence } from "@/types";
import { REMINDER_OFFSETS } from "@/utils/dateTime";
import { DEFAULT_TIMEZONE, toUtcIso, localDateStr } from "@/utils/dateTime";
import { attachTag, getTaskTags } from "@/services/tagService";
import { getSubtasks } from "@/services/subtaskService";
export interface CreateTaskInput {
  title: string;
  description?: string;
  taskDate: string;
  startTime: string;
  endTime: string;
  priority: TaskPriority;
  category?: string;
  reminderOffsets: number[];
  recurrence?: Recurrence | null;
  recurrenceUntil?: string | null;
  tagIds?: string[];
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  status?: TaskStatus;
  timezone?: string;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  priority: TaskPriority;
  category: string | null;
  status: TaskStatus;
  reminder_offsets: number[];
  recurrence: Recurrence | null;
  recurrence_until: string | null;
  series_id: string | null;
  schedule_timezone: string | null;
  series_timezone_locked: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TaskRow): Task {
  return { ...row };
}

export async function createTask(input: CreateTaskInput, userId: string, timezone: string = DEFAULT_TIMEZONE): Promise<Task> {
  const dateObj = new Date(input.taskDate + "T00:00:00");
  const startDatetime = toUtcIso(dateObj, input.startTime, timezone);
  const endDatetime = toUtcIso(dateObj, input.endTime, timezone);

  const [sh, sm] = input.startTime.split(":").map(Number);
  const [eh, em] = input.endTime.split(":").map(Number);
  const durationMinutes = eh * 60 + em - (sh * 60 + sm);
  const reminderOffsets = [...new Set(input.reminderOffsets)];
  assertSupportedReminderOffsets(reminderOffsets);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      task_date: input.taskDate,
      start_time: input.startTime,
      end_time: input.endTime,
      start_datetime: startDatetime,
      end_datetime: endDatetime,
      duration_minutes: durationMinutes,
      priority: input.priority,
      category: input.category ?? null,
      status: "PENDING",
      reminder_offsets: reminderOffsets,
      recurrence: input.recurrence ?? null,
      recurrence_until: input.recurrenceUntil ?? null,
      schedule_timezone: input.recurrence ? timezone : null,
      series_timezone_locked: Boolean(input.recurrence),
    })
    .select("*")
    .single();

  if (error) throw new Error(getServiceErrorMessage(error));
  const task = mapRow(data as TaskRow);

  /*
   * Reminders are created by the database, in the same transaction as this
   * insert, via `trg_create_task_reminders_on_insert` (migration 024). The
   * browser used to write them here, which made any insert that did not go
   * through this function — recurrence materialisation, a service-role insert,
   * a future caller — produce a task that would never notify.
   *
   * Offsets are still validated client-side so the user gets an immediate,
   * specific message rather than a database error; the database validates
   * independently via `tasks_reminder_offsets_valid`.
   */

  if (input.tagIds && input.tagIds.length > 0) {
    // Tags are cosmetic metadata: a failed link must not fail task creation.
    for (const tagId of input.tagIds) {
      await attachTag(task.id, tagId).catch(() => undefined);
    }
  }

  return task;
}

/*
 * Removed: `createRemindersForTask`.
 *
 * This used to build and insert reminder rows from the browser after a task
 * insert. Reminder creation is now a database invariant — the
 * `trg_create_task_reminders_on_insert` AFTER INSERT trigger (migration 024)
 * calls `public.create_task_reminders_for(NEW.id)` in the same transaction —
 * so this function was both redundant and unsafe: it could write a second,
 * divergent set of reminders, and any insert that bypassed it produced a task
 * that would never notify.
 *
 * `assertSupportedReminderOffsets` below is kept: it still runs before the
 * insert so the user gets an immediate, specific message instead of a database
 * constraint error, and it keeps `REMINDER_OFFSETS` as the single client-side
 * source of truth for the supported set.
 */

function assertSupportedReminderOffsets(offsets: number[]): void {
  const supported = new Set<number>(Object.values(REMINDER_OFFSETS));
  for (const offset of offsets) {
    if (!supported.has(offset)) {
      throw new Error(`Unsupported reminder offset: ${offset}`);
    }
  }
}

export function buildTaskUpdate(input: UpdateTaskInput): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description ?? null;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.category !== undefined) updates.category = input.category ?? null;
  if (input.status !== undefined) updates.status = input.status;
  if (input.recurrence !== undefined) updates.recurrence = input.recurrence;
  if (input.recurrenceUntil !== undefined) updates.recurrence_until = input.recurrenceUntil;
  if (input.reminderOffsets !== undefined) {
    const reminderOffsets = [...new Set(input.reminderOffsets)];
    assertSupportedReminderOffsets(reminderOffsets);
    updates.reminder_offsets = reminderOffsets;
  }

  if (input.taskDate !== undefined && input.startTime !== undefined && input.endTime !== undefined) {
    const dateObj = new Date(input.taskDate + "T00:00:00");
    const timezone = input.timezone ?? DEFAULT_TIMEZONE;
    updates.start_datetime = toUtcIso(dateObj, input.startTime, timezone);
    updates.end_datetime = toUtcIso(dateObj, input.endTime, timezone);
    updates.task_date = input.taskDate;
    updates.start_time = input.startTime;
    updates.end_time = input.endTime;
    const [sh, sm] = input.startTime.split(":").map(Number);
    const [eh, em] = input.endTime.split(":").map(Number);
    updates.duration_minutes = eh * 60 + em - (sh * 60 + sm);
  }

  return updates;
}

export function getOwnedTasks(tasks: Task[], userId: string | undefined): Task[] {
  return userId ? tasks.filter((task) => task.user_id === userId) : [];
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  const updates = buildTaskUpdate(input);

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw new Error(getServiceErrorMessage(error));
  const task = mapRow(data as TaskRow);

  // Pending reminders are rebuilt transactionally by the database trigger when
  // the owner changes schedule fields or reminder offsets. Sent reminders are
  // intentionally left untouched by that trigger.
  if (input.tagIds !== undefined) {
    await syncTaskTags(taskId, input.tagIds);
  }

  return task;
}

/**
 * Makes a task's tag links match `tagIds` exactly. Only the caller's own tags
 * can be linked (the `tags` select policy is RLS-scoped to the signed-in
 * user), so unknown or foreign ids are dropped instead of failing the save.
 * Row-level security on `task_tags` still decides whether a collaborator may
 * write at all, and those failures surface to the caller.
 */
async function syncTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(tagIds)];
  const idCandidates = uniqueIds.length > 0 ? uniqueIds : ["00000000-0000-0000-0000-000000000000"];

  const { data: ownTags, error: ownError } = await supabase
    .from("tags")
    .select("id")
    .in("id", idCandidates);
  if (ownError) throw new Error(getServiceErrorMessage(ownError));
  const allowed = new Set((ownTags ?? []).map((row: { id: string }) => row.id));

  const { data: linkRows, error: linkError } = await supabase
    .from("task_tags")
    .select("tag_id")
    .eq("task_id", taskId);
  if (linkError) throw new Error(getServiceErrorMessage(linkError));
  const current = new Set((linkRows ?? []).map((row: { tag_id: string }) => row.tag_id));

  for (const tagId of allowed) {
    if (!current.has(tagId)) await attachTag(taskId, tagId);
  }
  for (const tagId of current) {
    if (!allowed.has(tagId)) {
      const { error: detachError } = await supabase
        .from("task_tags")
        .delete()
        .eq("task_id", taskId)
        .eq("tag_id", tagId);
      if (detachError) throw new Error(getServiceErrorMessage(detachError));
    }
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(getServiceErrorMessage(error));
}

export async function getTask(taskId: string): Promise<TaskWithRelations | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(getServiceErrorMessage(error));
  const task = data ? mapRow(data as TaskRow) : null;
  if (!task) return null;
  const [tags, subtasks] = await Promise.all([
    getTaskTags(taskId).catch(() => []),
    getSubtasks(taskId).catch(() => []),
  ]);
  return { ...task, tags, subtasks };
}

/**
 * The outcome of loading a task together with its relations.
 *
 * `tagsLoaded` exists so the edit form can tell "this task genuinely has no
 * tags" apart from "the tag request failed". Conflating the two is what made a
 * transient network error silently detach every tag from a task.
 */
export interface EditableTaskLoad {
  task: TaskWithRelations | null;
  tagsLoaded: boolean;
  subtasksLoaded: boolean;
}

/**
 * Loads a task for editing, reporting whether each relation request actually
 * succeeded instead of substituting an empty list on failure.
 *
 * `getTask` above deliberately degrades relations to `[]` for read-only
 * display, where showing a task without its tags is a cosmetic problem. That is
 * unacceptable in the edit form, because the form writes tags back: an empty
 * list produced by a failure would be submitted as "this task has no tags" and
 * delete them. Callers must therefore block saving while `tagsLoaded` is false.
 */
export async function getTaskForEdit(taskId: string): Promise<EditableTaskLoad> {
  const task = await getTaskBase(taskId);
  if (!task) return { task: null, tagsLoaded: true, subtasksLoaded: true };

  const [tagsResult, subtasksResult] = await Promise.allSettled([
    getTaskTags(taskId),
    getSubtasks(taskId),
  ]);

  return {
    task: {
      ...task,
      tags: tagsResult.status === "fulfilled" ? tagsResult.value : [],
      subtasks: subtasksResult.status === "fulfilled" ? subtasksResult.value : [],
    },
    tagsLoaded: tagsResult.status === "fulfilled",
    subtasksLoaded: subtasksResult.status === "fulfilled",
  };
}

/** The task row on its own, with no relation loading. */
async function getTaskBase(taskId: string): Promise<Task | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(getServiceErrorMessage(error));
  return data ? mapRow(data as TaskRow) : null;
}

export async function getTaskReminders(taskId: string): Promise<TaskReminder[]> {
  const { data, error } = await supabase
    .from("task_reminders")
    .select("*")
    .eq("task_id", taskId)
    .order("reminder_time", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []) as TaskReminder[];
}

export async function listTasks(filters?: {
  status?: TaskStatus;
  priority?: TaskPriority;
  category?: string;
}): Promise<Task[]> {
  let query = supabase.from("tasks").select("*").order("start_datetime", { ascending: true });
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.priority) query = query.eq("priority", filters.priority);
  if (filters?.category) query = query.eq("category", filters.category);

  const { data, error } = await query;
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

export async function getTodayTasks(timezone: string = DEFAULT_TIMEZONE): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("task_date", localToday(timezone))
    .order("start_datetime", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

export async function getUpcomingTasks(): Promise<Task[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .gt("start_datetime", now)
    .neq("status", "CANCELLED")
    .neq("status", "COMPLETED")
    .order("start_datetime", { ascending: true })
    .limit(20);
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

export async function getOverdueTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "OVERDUE")
    .order("end_datetime", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

function localToday(timezone: string): string {
  return localDateStr(new Date(), timezone);
}

export async function getTasksByDate(date: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("task_date", date)
    .order("start_datetime", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

export async function searchTasks(query: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .ilike("title", `%${query}%`)
    .order("start_datetime", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

export async function startTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "IN_PROGRESS" });
}

export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "COMPLETED" });
}

export async function cancelTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "CANCELLED" });
}
