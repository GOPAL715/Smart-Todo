import { matchExistingTags } from "@/utils/taskDraftParser";
import type { TaskPriority, Recurrence, ParsedTaskDraft } from "@/types";

/**
 * Validation and merge rules for an AI-produced task draft.
 *
 * AI output is treated as **untrusted input**. Everything is re-checked against
 * the application's own domain constraints before it can reach the review
 * screen, and again in the Edge Function before it leaves the server.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **Nothing is invented.** A value the model returns that does not match a
 *    supported domain value is dropped and reported, never rounded to the
 *    nearest valid one. A reminder of "3 days" does not silently become
 *    "1 day".
 * 2. **The deterministic parse wins.** `mergeAiDraft` treats the local parser's
 *    output as the authority and only *fills gaps* the model left. If the user
 *    said "tomorrow at 6 PM", the draft cannot become a different day or time
 *    because the model preferred something else.
 *
 * The reminder offsets are duplicated from `dateTime.REMINDER_OFFSETS` rather
 * than imported, because this module is mirrored verbatim inside the Deno Edge
 * Function, which cannot resolve the app's `@/` path alias. The duplication is
 * asserted by a test.
 */

/** The subset of reminder offsets the application already supports. */
export const SUPPORTED_REMINDER_OFFSETS = [1440, 120, 60, 30, 15, 10, 5, 0];

export const ALLOWED_PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const ALLOWED_RECURRENCES: Recurrence[] = ["DAILY", "WEEKLY", "MONTHLY"];

/** Field names the model is permitted to return. Anything else is discarded. */
export const ALLOWED_FIELDS = [
  "title",
  "description",
  "start_date",
  "start_time",
  "end_time",
  "priority",
  "recurrence",
  "reminder_offset_minutes",
  "notes",
] as const;

/** Caps that keep a pathological model response from consuming memory or UI. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_NOTES = 8;
export const MAX_NOTE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `yyyy-MM-dd` that is a real calendar date (rejects 2026-02-30 and friends). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through UTC noon: rejects impossible dates with no dependence on
  // the host timezone.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** `HH:mm` within a real day. */
export function isValidHhMm(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/** A real IANA zone name, checked with `Intl` rather than a guessed list. */
export function isValidTimezoneName(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The raw shape the model is asked to produce. Every field is optional. */
export interface AiRawDraft {
  title?: unknown;
  description?: unknown;
  start_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  priority?: unknown;
  recurrence?: unknown;
  reminder_offset_minutes?: unknown;
  notes?: unknown;
}

export interface ValidatedAiDraft {
  title: string;
  description?: string;
  taskDate?: string;
  startTime?: string;
  endTime?: string;
  priority?: TaskPriority;
  recurrence?: Recurrence | null;
  reminderOffset?: number;
  notes: string[];
  /** Reasons a value was rejected, surfaced to the user rather than swallowed. */
  rejections: string[];
}

/**
 * Validates a raw model response into a draft the application understands.
 *
 * Every rejection is recorded rather than thrown, so the review screen can
 * explain what was dropped instead of silently changing the result.
 */
export function validateAiDraft(raw: unknown): ValidatedAiDraft {
  const rejections: string[] = [];

  if (!isRecord(raw)) {
    return { title: "", notes: [], rejections: ["The AI response was not an object."] };
  }

  // Strip unknown fields explicitly, so a model that invents `user_id` or
  // `task_id` cannot smuggle it into the application.
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
      delete raw[key];
    }
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length === 0) rejections.push("The AI did not provide a title.");
  const safeTitle = title.slice(0, MAX_TITLE_LENGTH);
  if (title.length > MAX_TITLE_LENGTH) {
    rejections.push("The AI's title was too long and was shortened.");
  }

  let description: string | undefined;
  if (typeof raw.description === "string" && raw.description.trim().length > 0) {
    description = raw.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  }

  let taskDate: string | undefined;
  if (raw.start_date !== undefined && raw.start_date !== null) {
    if (typeof raw.start_date !== "string" || !isValidIsoDate(raw.start_date)) {
      rejections.push("The AI's date was not a valid date, so it was ignored.");
    } else {
      taskDate = raw.start_date;
    }
  }

  let startTime: string | undefined;
  if (raw.start_time !== undefined && raw.start_time !== null && raw.start_time !== "") {
    if (typeof raw.start_time !== "string" || !isValidHhMm(raw.start_time)) {
      rejections.push("The AI's start time was not a valid time, so it was ignored.");
    } else {
      startTime = raw.start_time;
    }
  }

  let endTime: string | undefined;
  if (raw.end_time !== undefined && raw.end_time !== null && raw.end_time !== "") {
    if (typeof raw.end_time !== "string" || !isValidHhMm(raw.end_time)) {
      rejections.push("The AI's end time was not a valid time, so it was ignored.");
    } else {
      endTime = raw.end_time;
    }
  }

  // Cross-midnight is not representable in this application.
  if (startTime && endTime && endTime <= startTime) {
    rejections.push("The AI's end time was not after its start time, so it was ignored.");
    endTime = undefined;
  }

  let priority: TaskPriority | undefined;
  if (raw.priority !== undefined && raw.priority !== null && raw.priority !== "") {
    if (typeof raw.priority === "string" && (ALLOWED_PRIORITIES as string[]).includes(raw.priority)) {
      priority = raw.priority as TaskPriority;
    } else {
      rejections.push("The AI suggested a priority this app does not support, so it was ignored.");
    }
  }

  let recurrence: Recurrence | null = null;
  if (raw.recurrence !== undefined && raw.recurrence !== null && raw.recurrence !== "") {
    if (typeof raw.recurrence === "string" && (ALLOWED_RECURRENCES as string[]).includes(raw.recurrence)) {
      recurrence = raw.recurrence as Recurrence;
    } else {
      rejections.push("The AI suggested a repeat this app does not support, so it was ignored.");
    }
  }

  let reminderOffset: number | undefined;
  if (raw.reminder_offset_minutes !== undefined && raw.reminder_offset_minutes !== null) {
    const offset = raw.reminder_offset_minutes;
    if (typeof offset === "number" && SUPPORTED_REMINDER_OFFSETS.includes(offset)) {
      reminderOffset = offset;
    } else {
      // Deliberately NOT snapped to the nearest supported value.
      rejections.push(
        "The AI suggested a reminder time this app does not offer, so no reminder was set."
      );
    }
  }

  let notes: string[] = [];
  if (Array.isArray(raw.notes)) {
    notes = raw.notes
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n) => n.trim().slice(0, MAX_NOTE_LENGTH))
      .slice(0, MAX_NOTES);
  }

  return {
    title: safeTitle,
    description,
    taskDate,
    startTime,
    endTime,
    priority,
    recurrence,
    reminderOffset,
    notes,
    rejections,
  };
}

export interface MergeOptions {
  timezone: string;
  existingTagNames?: string[];
}

/**
 * Merges a validated AI draft with the deterministic parse.
 *
 * The deterministic result is the **safety baseline**: any field it resolved
 * from the user's own words wins outright, so a model can never move a task to
 * a different day or time than the user said. The AI only contributes where the
 * deterministic parser found nothing, and even then only after validation.
 *
 * Tag suggestions are resolved against the user's existing tags only, so the
 * model can never cause a tag to be created.
 */
export function mergeAiDraft(
  ai: ValidatedAiDraft,
  deterministic: ParsedTaskDraft,
  options: MergeOptions
): ParsedTaskDraft {
  const base = deterministic.draft;
  const notes = [...deterministic.notes, ...ai.notes, ...ai.rejections];
  const unresolved = [...deterministic.unresolved];

  const title = base.title.length > 0 ? base.title : ai.title;
  const taskDate = base.taskDate ?? ai.taskDate;
  const startTime = base.startTime ?? ai.startTime;
  const endTime = base.endTime ?? ai.endTime;
  const description = base.description ?? ai.description;

  // Priority: the deterministic parse only reports MEDIUM when it saw no
  // urgency, so an AI priority is accepted only when the parser found no
  // signal of its own. The user can still change it on the review screen.
  const deterministicSuggestedPriority =
    base.priority !== "MEDIUM" ? base.priority : undefined;
  const priority = deterministicSuggestedPriority ?? ai.priority ?? base.priority;

  const recurrence = base.recurrence ?? ai.recurrence ?? null;

  const reminderOffsets = [...base.reminderOffsets];
  if (reminderOffsets.length === 0 && ai.reminderOffset !== undefined) {
    reminderOffsets.push(ai.reminderOffset);
  }

  // Tags: matched against the user's own tags only, never invented.
  const suggestedTagNames = matchExistingTags(
    deterministic.draft.title,
    options.existingTagNames ?? []
  );

  const resolvedUnresolved = unresolved.filter(
    (field) => (field === "taskDate" ? !taskDate : field === "startTime" ? !startTime : field === "endTime" ? !endTime : true)
  );

  return {
    draft: {
      title,
      description,
      taskDate,
      startTime,
      endTime,
      timezone: options.timezone,
      priority,
      reminderOffsets,
      recurrence,
      suggestedTagNames,
    },
    unresolved: resolvedUnresolved,
    notes,
  };
}
