import type { Subtask, TaskDraft, TaskPriority } from "@/types";

/**
 * Deterministic, explainable task intelligence.
 *
 * Every function here is pure: it reads already-loaded data, returns new
 * objects, and never mutates its inputs. Nothing in this module writes to the
 * database, calls a network, or calls a model — the whole layer is arithmetic
 * over data the app has already fetched.
 *
 * The design rule is that a suggestion is only ever *advice*. Stored task
 * state is never modified, so there is no autonomous reprioritisation or
 * rescheduling anywhere in the system.
 */

/** The minimal task shape the analysis needs. `Task` satisfies it. */
export interface AnalyzableTask {
  id: string;
  user_id: string;
  title: string;
  status: string;
  priority: TaskPriority;
  task_date: string;
  start_datetime: string;
  end_datetime: string;
  reminder_offsets: number[];
  recurrence: string | null;
  created_at: string;
}

/** User's timezone and "now", so all day boundaries resolve in their zone. */
export interface IntelligenceContext {
  /** IANA zone, e.g. "Asia/Kolkata". Never the browser's own offset. */
  timezone: string;
  /** The user's current date in that zone, `yyyy-MM-dd`. */
  todayStr: string;
  /** The current instant. Injectable so results are deterministic in tests. */
  now: Date;
}

export interface PrioritySuggestion {
  suggestedPriority: TaskPriority;
  /**
   * True only when the suggestion differs from the stored priority. A false
   * value means "leave it alone", which is the common case.
   */
  isChange: boolean;
  reasons: string[];
}

export interface ReminderSuggestion {
  /** An offset the application already supports, in minutes. */
  offsetMinutes: number;
  label: string;
  reasons: string[];
}

/** Everything the intelligence layer can say about one task. */
export interface TaskInsight {
  prioritySuggestion: PrioritySuggestion;
  /** Present only when the task has no reminder and a clear case for one. */
  reminderSuggestion: ReminderSuggestion | null;
  /** True when the task warrants attention now, with the reason why. */
  needsAttention: boolean;
  attentionReasons: string[];
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** Supported reminder offsets, mirroring `REMINDER_OFFSETS` in dateTime. */
export const SUPPORTED_REMINDER_OFFSETS = [1440, 120, 60, 30, 15, 10, 5, 0] as const;

function labelForOffset(minutes: number): string {
  switch (minutes) {
    case 1440:
      return "1 day before";
    case 120:
      return "2 hours before";
    case 60:
      return "1 hour before";
    case 30:
      return "30 minutes before";
    case 15:
      return "15 minutes before";
    case 10:
      return "10 minutes before";
    case 5:
      return "5 minutes before";
    default:
      return "At start time";
  }
}

/** Whole days from today to `dateStr`; negative when the date has passed. */
export function daysFromToday(dateStr: string, todayStr: string): number {
  const toUtcNoon = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 12, 0, 0);
  };
  return Math.round((toUtcNoon(dateStr) - toUtcNoon(todayStr)) / 86_400_000);
}

/** Hours from `now` until `iso`, or null when the value is unusable. */
export function hoursUntil(iso: string, now: Date): number | null {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  return (target - now.getTime()) / 3_600_000;
}

/** Count of subtasks that are not yet finished. */
export function countIncompleteSubtasks(subtasks?: Subtask[]): number {
  if (!subtasks) return 0;
  let count = 0;
  for (const subtask of subtasks) {
    if (!subtask.is_completed) count++;
  }
  return count;
}

/**
 * Explains what a single task's signals are, without recommending anything.
 *
 * Split out from `analyzeTask` so the priority rule and the attention rule can
 * be read — and tested — independently.
 */
function gatherSignals(
  task: AnalyzableTask,
  context: IntelligenceContext,
  incompleteSubtasks: number
) {
  const dayOffset = daysFromToday(task.task_date, context.todayStr);
  const hoursToStart = hoursUntil(task.start_datetime, context.now);
  const isDone = task.status === "COMPLETED" || task.status === "CANCELLED";

  const reasons: string[] = [];
  const attentionReasons: string[] = [];

  if (isDone) {
    // A finished task is never "in need of attention", whatever its date says.
    return { dayOffset, hoursToStart, isDone, reasons, attentionReasons, incompleteSubtasks };
  }

  if (task.status === "OVERDUE") {
    const overdueBy = Math.abs(dayOffset);
    const phrase =
      overdueBy === 0
        ? "Overdue today"
        : `Overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}`;
    reasons.push(phrase);
    attentionReasons.push(phrase);
  } else if (dayOffset === 0) {
    reasons.push("Due today");
  } else if (dayOffset === 1) {
    reasons.push("Due tomorrow");
  } else if (dayOffset < 0) {
    reasons.push(`Date has passed (${Math.abs(dayOffset)} day${Math.abs(dayOffset) === 1 ? "" : "s"} ago)`);
  }

  if (hoursToStart !== null && hoursToStart >= 0 && hoursToStart <= 2) {
    reasons.push("Starts within the next 2 hours");
  }

  if (task.recurrence) {
    reasons.push(`Recurring (${task.recurrence.toLowerCase()})`);
    if (dayOffset === 0) reasons.push("Recurring task due today");
  }

  if (incompleteSubtasks > 0) {
    const phrase = `Has ${incompleteSubtasks} incomplete subtask${incompleteSubtasks === 1 ? "" : "s"}`;
    reasons.push(phrase);
  }

  if (task.reminder_offsets.length === 0) {
    reasons.push("No reminder set");
  }

  reasons.push(`Existing priority is ${task.priority}`);

  return { dayOffset, hoursToStart, isDone, reasons, attentionReasons, incompleteSubtasks };
}

/**
 * Suggests a priority, and always explains why.
 *
 * The stored priority is read, never written. The suggestion is a lower bound
 * derived from concrete, explainable facts; a task with no strong signal keeps
 * its existing priority, so this never churns values.
 */
export function suggestPriority(
  task: AnalyzableTask,
  context: IntelligenceContext,
  subtasks?: Subtask[]
): PrioritySuggestion {
  const incompleteSubtasks = countIncompleteSubtasks(subtasks);
  const signals = gatherSignals(task, context, incompleteSubtasks);

  if (signals.isDone) {
    return { suggestedPriority: task.priority, isChange: false, reasons: [] };
  }

  // Start from the stored priority and only ever raise it.
  let target = task.priority;

  if (task.status === "OVERDUE") {
    target = task.priority === "URGENT" ? "URGENT" : "HIGH";
  } else if (signals.dayOffset === 0 && signals.hoursToStart !== null && signals.hoursToStart <= 2) {
    // Due today and about to start: worth raising, but not past URGENT.
    // `PRIORITY_ORDER` is inverted (URGENT is 0 and is therefore the *most*
    // urgent), so "less urgent than HIGH" is a strictly greater index.
    target = PRIORITY_ORDER[task.priority] > PRIORITY_ORDER.HIGH ? "HIGH" : task.priority;
  } else if (signals.dayOffset === 0 && task.priority === "LOW") {
    target = "MEDIUM";
  }

  if (target === "URGENT" && task.priority !== "URGENT" && task.status !== "OVERDUE") {
    // URGENT is only ever reached through an explicit stored value or an
    // overdue status, never inferred from timing alone.
    target = "HIGH";
  }

  const isChange = target !== task.priority;
  return {
    suggestedPriority: target,
    isChange,
    reasons: isChange ? signals.reasons : [],
  };
}

/**
 * Suggests a reminder only when there is a defensible reason.
 *
 * A task that already has any reminder is left alone, and no offset is
 * suggested for a task that is far away or already finished. Only offsets the
 * application already supports are ever returned.
 */
export function suggestReminder(
  task: AnalyzableTask,
  context: IntelligenceContext
): ReminderSuggestion | null {
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return null;
  if (task.reminder_offsets.length > 0) return null;

  const dayOffset = daysFromToday(task.task_date, context.todayStr);
  const hoursToStart = hoursUntil(task.start_datetime, context.now);

  // A task far in the future has no reason for an urgent nudge.
  if (dayOffset > 1) return null;
  if (hoursToStart !== null && hoursToStart < 0) return null;

  const reasons: string[] = [];
  let offset: number;

  if (dayOffset === 0) {
    offset = 30;
    reasons.push("Starts today");
  } else {
    offset = 60;
    reasons.push("Starts tomorrow");
  }

  if (task.priority === "URGENT" || task.priority === "HIGH") {
    reasons.push(`${task.priority}-priority task`);
    // A more urgent task earns a longer heads-up, not a shorter one.
    offset = dayOffset === 0 ? 60 : 120;
  }

  if (!SUPPORTED_REMINDER_OFFSETS.includes(offset as (typeof SUPPORTED_REMINDER_OFFSETS)[number])) {
    return null;
  }

  return { offsetMinutes: offset, label: labelForOffset(offset), reasons };
}

/**
 * The full picture for one task.
 *
 * Recommendation-only: the returned `prioritySuggestion.isChange` tells the UI
 * whether there is anything worth surfacing, and the task object itself is
 * never touched.
 */
export function analyzeTask(
  task: AnalyzableTask,
  context: IntelligenceContext,
  subtasks?: Subtask[]
): TaskInsight {
  const incompleteSubtasks = countIncompleteSubtasks(subtasks);
  const signals = gatherSignals(task, context, incompleteSubtasks);

  let needsAttention = false;
  const attentionReasons = [...signals.attentionReasons];

  if (!signals.isDone && task.status === "OVERDUE") {
    needsAttention = true;
    if (task.priority === "URGENT" || task.priority === "HIGH") {
      attentionReasons.push(`${task.priority}-priority task`);
    }
    if (incompleteSubtasks > 0) {
      attentionReasons.push(`${incompleteSubtasks} incomplete subtask${incompleteSubtasks === 1 ? "" : "s"}`);
    }
    if (task.recurrence) {
      attentionReasons.push("Recurring task");
    }
  } else if (!signals.isDone && task.recurrence && signals.dayOffset === 0) {
    needsAttention = true;
    attentionReasons.push("Recurring task due today");
  }

  return {
    prioritySuggestion: suggestPriority(task, context, subtasks),
    reminderSuggestion: suggestReminder(task, context),
    needsAttention,
    attentionReasons,
  };
}

/**
 * Scores a task for smart ordering. Higher means more urgent.
 *
 * Deliberately a plain additive score over explainable facts rather than a
 * weighted model: the ordering has to be reproducible and reviewable.
 */
export function scoreTask(task: AnalyzableTask, context: IntelligenceContext): number {
  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    // Finished tasks always sink, whatever they were scored before.
    return -1000;
  }

  let score = 0;

  // Overdue dominates everything else.
  if (task.status === "OVERDUE") {
    const days = Math.abs(daysFromToday(task.task_date, context.todayStr));
    score += 1000 + days * 10;
  }

  score += (3 - PRIORITY_ORDER[task.priority]) * 100;

  // Starting soon outranks starting later.
  const hours = hoursUntil(task.start_datetime, context.now);
  if (hours !== null) {
    if (hours <= 0) {
      // Already started: still live work, but past its "upcoming" window.
      score += 40;
    } else if (hours <= 2) {
      score += 80;
    } else if (hours <= 24) {
      score += 50;
    } else if (daysFromToday(task.task_date, context.todayStr) <= 7) {
      score += 25;
    }
  }

  // Work already in progress.
  if (task.status === "IN_PROGRESS") score += 20;

  return score;
}

/**
 * Returns a new array ordered by smart urgency.
 *
 * The input array and every task in it are left untouched: the result is a new
 * array, and ties are broken by start time and then by id so the ordering is
 * fully deterministic and stable across renders.
 */
export function rankTasks<T extends AnalyzableTask>(
  tasks: T[],
  context: IntelligenceContext
): T[] {
  return [...tasks].sort((a, b) => {
    const diff = scoreTask(b, context) - scoreTask(a, context);
    if (diff !== 0) return diff;

    // Stable, deterministic tie-breaks.
    const byStart = (a.start_datetime ?? "").localeCompare(b.start_datetime ?? "");
    if (byStart !== 0) return byStart;

    return a.id.localeCompare(b.id);
  });
}

/** A short, human-readable workload snapshot. */
export interface WorkloadSummary {
  dueToday: number;
  next24Hours: number;
  highPrioritySoon: number;
  overdue: number;
  needsAttention: number;
  /** Pre-written sentences, so the UI renders no derived copy. */
  messages: string[];
}

/**
 * Summarises upcoming workload from already-loaded tasks.
 *
 * Shares the day-boundary and date helpers with the rest of the app, so the
 * numbers agree with what the task list and dashboard already show. This adds
 * no queries and creates no second analytics implementation.
 */
export function summarizeWorkload(
  tasks: AnalyzableTask[],
  context: IntelligenceContext
): WorkloadSummary {
  let dueToday = 0;
  let next24Hours = 0;
  let highPrioritySoon = 0;
  let overdue = 0;
  let needsAttention = 0;

  for (const task of tasks) {
    if (task.status === "COMPLETED" || task.status === "CANCELLED") continue;

    if (task.status === "OVERDUE") overdue++;

    const dayOffset = daysFromToday(task.task_date, context.todayStr);
    if (dayOffset === 0) dueToday++;

    const hours = hoursUntil(task.start_datetime, context.now);
    if (hours !== null && hours > 0 && hours <= 24) {
      next24Hours++;
      if (task.priority === "HIGH" || task.priority === "URGENT") highPrioritySoon++;
    }

    if (analyzeTask(task, context).needsAttention) needsAttention++;
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const messages: string[] = [];
  if (dueToday > 0) messages.push(`${plural(dueToday, "task")} scheduled today.`);
  if (highPrioritySoon > 0) {
    messages.push(`${plural(highPrioritySoon, "high-priority task")} in the next 24 hours.`);
  } else if (next24Hours > 0) {
    messages.push(`${plural(next24Hours, "task")} in the next 24 hours.`);
  }
  if (overdue > 0) messages.push(`${plural(overdue, "overdue task")} still need attention.`);
  if (messages.length === 0) messages.push("Nothing scheduled and nothing overdue.");

  return { dueToday, next24Hours, highPrioritySoon, overdue, needsAttention, messages };
}

/**
 * Adapts a Phase 13A draft to the shape this module analyses.
 *
 * Kept here rather than in a component so the mapping is unit-testable and so no
 * component file has to export a non-component. The draft has no database id
 * yet, so a stable placeholder is used; nothing here writes, so the id only
 * matters for deterministic tie-breaks.
 */
export function toAnalyzableDraft(draft: TaskDraft): AnalyzableTask {
  const startIso =
    draft.taskDate && draft.startTime
      ? new Date(`${draft.taskDate}T${draft.startTime}:00`).toISOString()
      : `${draft.taskDate ?? "1970-01-01"}T00:00:00.000Z`;

  return {
    id: "draft",
    user_id: "",
    title: draft.title,
    status: "PENDING",
    priority: draft.priority,
    task_date: draft.taskDate ?? "1970-01-01",
    start_datetime: startIso,
    end_datetime: startIso,
    reminder_offsets: draft.reminderOffsets,
    recurrence: draft.recurrence ?? null,
    created_at: new Date().toISOString(),
  };
}


