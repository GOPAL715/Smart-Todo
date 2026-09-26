import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Task, TaskWithRelations, TaskReminder, TaskStatus, TaskPriority, Recurrence } from "@/types";
import { REMINDER_OFFSETS } from "@/utils/dateTime";
import { DEFAULT_TIMEZONE, toUtcIso, localDateStr, calendarDateKey } from "@/utils/dateTime";
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

/** The persisted schedule columns, which must always be written as a consistent set. */
export interface TaskScheduleUpdate {
  task_date: string;
  start_time: string;
  end_time: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
}

/**
 * Builds the schedule columns from a complete `date + start + end` tuple.
 *
 * Two invariants are enforced here rather than at the database, because the
 * failure is opaque when it reaches Postgres:
 *
 * 1. **Cross-midnight tasks are not supported.** SmartTodo has no notion of an
 *    end on the following day, so `23:00 -> 01:00` cannot be represented. The
 *    schema actively forbids it (`CHECK (end_datetime > start_datetime)` and
 *    `CHECK (duration_minutes > 0)` from migration 023), so this is an existing
 *    constraint being made explicit, not a new rule. Attempting it previously
 *    produced a negative duration and a raw constraint error.
 * 2. **Start and end must differ**, so duration is always strictly positive.
 *
 * @throws Error with user-safe copy when the tuple is invalid.
 */
export function buildTaskSchedule(
  taskDate: string,
  startTime: string,
  endTime: string,
  timezone: string = DEFAULT_TIMEZONE
): TaskScheduleUpdate {
  const startMinutes = parseHhMm(startTime);
  const endMinutes = parseHhMm(endTime);

  if (startMinutes === null || endMinutes === null) {
    throw new Error("Start and end time must be in HH:mm format.");
  }

  if (startMinutes === endMinutes) {
    throw new Error("Start and end time must be different.");
  }

  if (endMinutes < startMinutes) {
    throw new Error(
      "End time must be after start time. Tasks that end the next day are not supported yet."
    );
  }

  const dateObj = new Date(taskDate + "T00:00:00");
  if (Number.isNaN(dateObj.getTime())) {
    throw new Error("Please choose a valid date.");
  }

  return {
    task_date: taskDate,
    start_time: startTime,
    end_time: endTime,
    start_datetime: toUtcIso(dateObj, startTime, timezone),
    end_datetime: toUtcIso(dateObj, endTime, timezone),
    duration_minutes: endMinutes - startMinutes,
  };
}

/** Parses "HH:mm" into minutes past midnight, or null when malformed. */
function parseHhMm(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export async function createTask(input: CreateTaskInput, userId: string, timezone: string = DEFAULT_TIMEZONE): Promise<Task> {
  const reminderOffsets = [...new Set(input.reminderOffsets)];
  assertSupportedReminderOffsets(reminderOffsets);

  // Validated before any write, so an invalid schedule can never reach the
  // database and fail there with a constraint error the user cannot interpret.
  const schedule = buildTaskSchedule(input.taskDate, input.startTime, input.endTime, timezone);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      task_date: schedule.task_date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      start_datetime: schedule.start_datetime,
      end_datetime: schedule.end_datetime,
      duration_minutes: schedule.duration_minutes,
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

  /*
   * Schedule fields are written as one atomic set.
   *
   * The previous implementation applied them only when all three of
   * `taskDate`, `startTime` and `endTime` were present. A caller that supplied
   * a new date without times therefore had that date silently dropped, while
   * the UI showed the change — the change simply never persisted.
   *
   * Partial input is now rejected outright rather than merged. Merging would
   * require reading the task's existing row first, which `buildTaskUpdate` is a
   * pure function and cannot do, and every real caller (the edit form) already
   * sends the complete tuple. Failing loudly is the safer contract: it can never
   * leave `task_date`, `start_datetime` and `end_datetime` inconsistent.
   */
  const scheduleFields = [input.taskDate, input.startTime, input.endTime].filter(
    (value) => value !== undefined
  );

  if (scheduleFields.length > 0) {
    if (scheduleFields.length < 3) {
      throw new Error(
        "A task's date, start time and end time must be provided together."
      );
    }
    const timezone = input.timezone ?? DEFAULT_TIMEZONE;
    Object.assign(updates, buildTaskSchedule(input.taskDate!, input.startTime!, input.endTime!, timezone));
  }

  return updates;
}

export function getOwnedTasks(tasks: Task[], userId: string | undefined): Task[] {
  return userId ? tasks.filter((task) => task.user_id === userId) : [];
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  /*
   * When the caller is also changing tags, authorization is resolved BEFORE any
   * write. Previously the task row was updated first and permission was only
   * discovered afterwards, so a denied attempt could still have persisted a
   * partial change before failing.
   */
  if (input.tagIds !== undefined) {
    await assertCanEditTaskTags(taskId);
  }

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
 * Makes a task's tag links match `tagIds` exactly.
 *
 * Authorization is resolved up front, before any write, using the same
 * `get_task_access` RPC the rest of the app relies on (added in migration 015).
 * Previously the function discovered it had no permission only when an RLS
 * policy rejected a write, which could happen *after* some tags had already
 * been attached — leaving a partially updated task.
 *
 * A VIEW collaborator, or anyone with no relationship to the task, is now
 * rejected before the first mutation. This does not replace or weaken RLS: the
 * database policies remain the enforcement boundary, and the explicit check
 * exists so the user gets a clear message instead of a mid-loop failure.
 *
 * The writes themselves are still individual statements, because the app has no
 * transactional RPC for this and adding one would mean a schema change. The
 * up-front permission check plus RLS makes a partial application unlikely, and
 * a failure is reported to the caller rather than swallowed.
 */
async function syncTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(tagIds)];
  const idCandidates = uniqueIds.length > 0 ? uniqueIds : ["00000000-0000-0000-0000-000000000000"];

  // The `tags` select policy is RLS-scoped to the signed-in user, so this can
  // only ever return the caller's own tags. Unknown or foreign ids are dropped
  // rather than failing the save.
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

  // Attach first, detach second: if a single statement fails, the task is left
  // with a superset of its tags rather than silently losing them.
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

/**
 * Confirms the caller may modify this task's tag links.
 *
 * @throws Error with user-safe copy when the caller is not the owner and does
 * not hold an EDIT share. A VIEW share is rejected here rather than by RLS.
 */
async function assertCanEditTaskTags(taskId: string): Promise<void> {
  const { data, error } = await supabase.rpc("get_task_access", { p_task_id: taskId });
  if (error) throw new Error(getServiceErrorMessage(error));

  const access = data as { ok?: boolean; is_owner?: boolean; permission?: string } | null;
  if (!access?.ok) {
    throw new Error("You do not have permission to change this task.");
  }
  if (!access.is_owner && access.permission !== "EDIT") {
    throw new Error("You do not have permission to change this task.");
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

/**
 * All tasks whose `task_date` falls inside the inclusive `YYYY-MM-DD` range.
 *
 * The calendar used to call `getTasksByDate` once per grid cell, which is 35–42
 * sequential round trips to render a single month. This performs one range
 * query instead. It is the same `tasks` select under the same RLS policies, so
 * the caller still sees exactly the rows their permissions allow.
 */
export async function getTasksByDateRange(startDate: string, endDate: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .gte("task_date", startDate)
    .lte("task_date", endDate)
    .order("start_datetime", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []).map(mapRow);
}

/** Inclusive first/last `YYYY-MM-DD` keys covered by a set of calendar days. */
export function calendarRange(days: Date[]): { start: string; end: string } | null {
  if (days.length === 0) return null;
  return {
    start: calendarDateKey(days[0]),
    end: calendarDateKey(days[days.length - 1]),
  };
}

/**
 * Buckets tasks by their `task_date` for calendar rendering.
 *
 * Pure and exported so the grouping rule is unit testable without a DOM or a
 * network call. Days with no tasks are simply absent from the map, which is what
 * lets an empty day render normally.
 */
export function groupTasksByDate(tasks: Task[]): Record<string, Task[]> {
  const map: Record<string, Task[]> = {};
  for (const task of tasks) {
    if (!task.task_date) continue;
    const bucket = map[task.task_date];
    if (bucket) {
      bucket.push(task);
    } else {
      map[task.task_date] = [task];
    }
  }
  return map;
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
