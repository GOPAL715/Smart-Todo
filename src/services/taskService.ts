import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Task, TaskWithRelations, TaskReminder, ReminderType, TaskStatus, TaskPriority, Recurrence } from "@/types";
import { REMINDER_OFFSETS } from "@/utils/dateTime";
import { toUtcIso, calculateReminderTime, toZonedTime } from "@/utils/dateTime";
import { DEFAULT_TIMEZONE } from "@/utils/dateTime";
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
      reminder_offsets: input.reminderOffsets,
      recurrence: input.recurrence ?? null,
      recurrence_until: input.recurrenceUntil ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(getServiceErrorMessage(error));
  const task = mapRow(data as TaskRow);

  await createRemindersForTask(task, input.reminderOffsets);

  if (input.tagIds && input.tagIds.length > 0) {
    // Tags are cosmetic metadata: a failed link must not fail task creation.
    for (const tagId of input.tagIds) {
      await attachTag(task.id, tagId).catch(() => undefined);
    }
  }

  return task;
}

async function createRemindersForTask(task: Task, reminderOffsets: number[]): Promise<void> {
  const reminders: Array<{
    task_id: string;
    reminder_type: ReminderType;
    reminder_time: string;
    is_sent: boolean;
  }> = [];

  for (const offset of reminderOffsets) {
    const type = offsetToType(offset);
    const reminderTime = calculateReminderTime(task.start_datetime, offset);
    if (new Date(reminderTime) <= new Date()) continue; // skip past reminders
    reminders.push({
      task_id: task.id,
      reminder_type: type,
      reminder_time: reminderTime,
      is_sent: false,
    });
  }

  // NOT_STARTED reminder: 10 min after start
  const notStartedTime = new Date(new Date(task.start_datetime).getTime() + 10 * 60 * 1000).toISOString();
  if (new Date(notStartedTime) > new Date()) {
    reminders.push({
      task_id: task.id,
      reminder_type: "NOT_STARTED",
      reminder_time: notStartedTime,
      is_sent: false,
    });
  }

  // OVERDUE reminder: at end time
  if (new Date(task.end_datetime) > new Date()) {
    reminders.push({
      task_id: task.id,
      reminder_type: "OVERDUE",
      reminder_time: task.end_datetime,
      is_sent: false,
    });
  }

  if (reminders.length === 0) return;

  const { error } = await supabase.from("task_reminders").insert(reminders);
  if (error) throw new Error(getServiceErrorMessage(error));
}

function offsetToType(offset: number): ReminderType {
  const entry = Object.entries(REMINDER_OFFSETS).find(([, val]) => val === offset);
  return (entry?.[0] as ReminderType) ?? "CUSTOM";
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description ?? null;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.category !== undefined) updates.category = input.category ?? null;
  if (input.status !== undefined) updates.status = input.status;
  if (input.recurrence !== undefined) updates.recurrence = input.recurrence;
  if (input.recurrenceUntil !== undefined) updates.recurrence_until = input.recurrenceUntil;

  if (input.taskDate !== undefined && input.startTime !== undefined && input.endTime !== undefined) {
    const dateObj = new Date(input.taskDate + "T00:00:00");
    updates.start_datetime = toUtcIso(dateObj, input.startTime, input.timezone);
    updates.end_datetime = toUtcIso(dateObj, input.endTime, input.timezone);
    updates.task_date = input.taskDate;
    updates.start_time = input.startTime;
    updates.end_time = input.endTime;
    const [sh, sm] = input.startTime.split(":").map(Number);
    const [eh, em] = input.endTime.split(":").map(Number);
    updates.duration_minutes = eh * 60 + em - (sh * 60 + sm);
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw new Error(getServiceErrorMessage(error));
  const task = mapRow(data as TaskRow);

  const scheduleChanged =
    input.taskDate !== undefined || input.startTime !== undefined || input.endTime !== undefined;
  const remindersChanged = input.reminderOffsets !== undefined;

  if ((scheduleChanged || remindersChanged) && task.status !== "CANCELLED") {
    await replacePendingRemindersIfOwner(task, input.reminderOffsets);
  }

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

/**
 * Rebuilds the not-yet-sent reminders for a task so they match its current
 * schedule and offsets. Already-sent reminders are left alone, preserving the
 * delivery history. Occurrences generated later by the server get their own
 * reminders when they are created.
 *
 * Reminder rows are owned through the parent task and are not writable by a
 * collaborator, so this only runs for the task's owner. A collaborator editing a
 * task they were granted access to skips it instead of failing.
 */
async function replacePendingRemindersIfOwner(task: Task, offsets?: number[]): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.id !== task.user_id) return;

  const effectiveOffsets = offsets ?? task.reminder_offsets ?? [];

  const { error: deleteError } = await supabase
    .from("task_reminders")
    .delete()
    .eq("task_id", task.id)
    .eq("is_sent", false);
  if (deleteError) throw deleteError;

  await createRemindersForTask(task, effectiveOffsets);
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
  return toZonedTime(new Date(), timezone).toISOString().slice(0, 10);
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
