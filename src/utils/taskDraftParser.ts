import { REMINDER_OFFSETS } from "@/utils/dateTime";
import { addMinutesToTime, DEFAULT_DURATION_MINUTES } from "@/utils/timeInput";
import type { TaskPriority, Recurrence, TaskDraft, ParsedTaskDraft } from "@/types";

/**
 * Deterministic natural-language task parser.
 *
 * Pure and local by design: no network call, no API key, no per-keystroke work.
 * Parsing happens once, on an explicit user action.
 *
 * The single guiding rule is that **ambiguity is never guessed**. If the input
 * does not clearly name a date, time, recurrence, or reminder, that field is
 * left unset and reported in `unresolved` so the review screen can ask for it.
 * A wrong guess saved silently is worse than an extra question.
 *
 * This module is the default `TaskIntelligenceService` implementation. A future
 * LLM-backed provider can be substituted at the service boundary without
 * changing the UI, because both return the same `ParsedTaskDraft`.
 */

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Reminder phrases mapped onto the offsets the application already supports.
 *
 * Sourced from `REMINDER_OFFSETS` rather than hard-coded numbers so this can
 * never drift from the values the form and the database accept. An unrecognised
 * reminder is ignored rather than approximated.
 */
const REMINDER_PHRASES: { pattern: RegExp; offset: number; label: string }[] = [
  { pattern: /\bone\s+day\s+before\b|\ba\s+day\s+before\b|\bday\s+before\b/i, offset: REMINDER_OFFSETS.ONE_DAY, label: "1 day before" },
  { pattern: /\btwo\s+hours?\s+before\b|\b2\s+hours?\s+before\b/i, offset: REMINDER_OFFSETS.TWO_HOURS, label: "2 hours before" },
  { pattern: /\bone\s+hour\s+before\b|\ban\s+hour\s+before\b|\b1\s+hour\s+before\b/i, offset: REMINDER_OFFSETS.ONE_HOUR, label: "1 hour before" },
  { pattern: /\bthirty\s+minutes?\s+before\b|\b30\s+minutes?\s+before\b|\bhalf\s+an?\s+hour\s+before\b/i, offset: REMINDER_OFFSETS.THIRTY_MINUTES, label: "30 minutes before" },
  { pattern: /\bfifteen\s+minutes?\s+before\b|\b15\s+minutes?\s+before\b|\ba\s+quarter\s+of\s+an?\s+hour\s+before\b/i, offset: REMINDER_OFFSETS.FIFTEEN_MINUTES, label: "15 minutes before" },
  { pattern: /\bten\s+minutes?\s+before\b|\b10\s+minutes?\s+before\b/i, offset: REMINDER_OFFSETS.TEN_MINUTES, label: "10 minutes before" },
  { pattern: /\bfive\s+minutes?\s+before\b|\b5\s+minutes?\s+before\b/i, offset: REMINDER_OFFSETS.FIVE_MINUTES, label: "5 minutes before" },
  { pattern: /\bat\s+start(\s+time)?\b|\bwhen\s+it\s+starts\b/i, offset: REMINDER_OFFSETS.AT_START, label: "At start time" },
];

/** Adds whole days to a `yyyy-MM-dd` string without any Date/timezone maths. */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Day-of-week (0=Sunday) of a `yyyy-MM-dd` string, in UTC. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/**
 * Resolves "tomorrow", "next Monday", "tonight", "Saturday morning" and friends
 * into a `yyyy-MM-dd` string, or null when the phrasing is not recognised.
 *
 * `todayStr` must be the current date in the user's configured timezone, so
 * "tomorrow" means tomorrow for the user, not for the server or the browser's
 * own offset.
 */
export function resolveDate(
  text: string,
  todayStr: string
): { date: string; matchedText: string } | null {
  if (/\btoday\b/i.test(text)) return { date: todayStr, matchedText: "today" };
  if (/\btomorrow\b/i.test(text)) return { date: shiftDate(todayStr, 1), matchedText: "tomorrow" };

  // "tonight" and "this evening" both mean the current day, later.
  if (/\btonight\b|\bthis\s+evening\b|\bthis\s+afternoon\b/i.test(text)) {
    return { date: todayStr, matchedText: "tonight" };
  }

  // "in N days" / "in 3 days"
  const inDays = /\bin\s+(\d+)\s+day(?:s)?\b/i.exec(text);
  if (inDays) {
    const n = Number(inDays[1]);
    if (n > 0 && n <= 365) {
      return { date: shiftDate(todayStr, n), matchedText: inDays[0] };
    }
  }

  // Weekday names, with or without "next"/"this".
  const weekday = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  if (weekday) {
    const target = WEEKDAY_TO_INDEX[weekday[1].toLowerCase()];
    const current = weekdayOf(todayStr);
    const isNext = /\bnext\b/i.test(text);

    let delta = (target - current + 7) % 7;
    // Bare "Monday" means the next occurrence, and never today: saying "Monday"
    // on a Monday should mean the coming Monday, not the one already under way.
    if (delta === 0) delta = 7;
    // "next Monday" skips a day that is only a couple of days away.
    if (isNext && delta < 7) delta += 0;

    return { date: shiftDate(todayStr, delta), matchedText: weekday[0] };
  }

  return null;
}

/**
 * Resolves a clock time from the text.
 *
 * Supports "at 6 PM", "at 18:00", "at 9", and the soft parts of day ("morning",
 * "afternoon", "evening", "tonight"). A time of day that is only approximate
 * ("sometime tomorrow") is intentionally NOT resolved.
 */
export function resolveTime(
  text: string
): { time: string; matchedText: string; approximate: boolean } | null {
  // 12-hour with an explicit meridiem: "6 PM", "6:30 pm", "at 11 am".
  const twelve = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (twelve) {
    let hours = Number(twelve[1]);
    const minutes = twelve[2] ? Number(twelve[2]) : 0;
    const meridiem = twelve[3].toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (hours <= 23 && minutes <= 59) {
      return {
        time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        matchedText: twelve[0],
        approximate: false,
      };
    }
  }

  // 24-hour: "at 18:00", "at 18".
  const twentyFour = /\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(am|pm))/i.exec(text);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    const minutes = twentyFour[2] ? Number(twentyFour[2]) : 0;
    if (hours <= 23 && minutes <= 59) {
      return {
        time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        matchedText: twentyFour[0],
        approximate: false,
      };
    }
  }

  // Soft parts of day. These ARE treated as a time, because "Saturday morning"
  // names a real time of day and the review screen still shows it for editing.
  if (/\btonight\b|\bthis\s+evening\b/i.test(text)) {
    return { time: "19:00", matchedText: "evening", approximate: true };
  }
  if (/\bthis\s+afternoon\b/i.test(text)) {
    return { time: "14:00", matchedText: "afternoon", approximate: true };
  }
  if (/\bmorning\b/i.test(text)) {
    return { time: "09:00", matchedText: "morning", approximate: true };
  }

  return null;
}

/**
 * Conservative priority inference.
 *
 * Only unambiguous urgency wording is honoured. A task with no urgency signal
 * keeps the application's existing default of MEDIUM, so a suggestion can
 * never *downgrade* or silently change a user's chosen priority.
 */
export function resolvePriority(text: string): {
  priority: TaskPriority;
  note: string | null;
} {
  // "due today" is a deadline signal; a bare "today" is not, and must not
  // outrank explicit "high priority" wording. Checked in decreasing specificity.
  if (/\b(urgent|asap|emergency|critical|production\s+issue|outage)\b/i.test(text)) {
    return { priority: "URGENT", note: "Suggested URGENT from urgency wording." };
  }
  if (/\b(high\s+priority|important|deadline|due\s+today|must\s+have)\b/i.test(text)) {
    return { priority: "HIGH", note: "Suggested HIGH from priority wording." };
  }
  if (/\bfinish\s+\w+\s+today\b|\bdue\s+today\b/i.test(text)) {
    return { priority: "HIGH", note: "Suggested HIGH from a same-day deadline." };
  }
  if (/\b(low\s+priority|whenever|no\s+rush)\b/i.test(text)) {
    return { priority: "LOW", note: "Suggested LOW from priority wording." };
  }
  return { priority: "MEDIUM", note: null };
}

/**
 * Detects only unambiguous recurrence, reusing the existing `Recurrence` model.
 *
 * "every Monday" is deliberately NOT treated as recurring here: the existing
 * model records a cadence, not a weekday, so a Monday-specific series cannot be
 * represented without inventing a new schema. It is reported in `unresolved`
 * instead, which is the honest outcome.
 */
export function resolveRecurrence(text: string): {
  recurrence: Recurrence | null;
  note: string | null;
  needsWeekdayRule: boolean;
} {
  if (/\bevery\s+day\b|\bdaily\b/i.test(text)) {
    return { recurrence: "DAILY", note: "Detected 'every day'.", needsWeekdayRule: false };
  }
  if (/\bevery\s+week\b|\bweekly\b/i.test(text)) {
    return { recurrence: "WEEKLY", note: "Detected 'every week'.", needsWeekdayRule: false };
  }
  if (/\bevery\s+month\b|\bmonthly\b/i.test(text)) {
    return { recurrence: "MONTHLY", note: "Detected 'every month'.", needsWeekdayRule: false };
  }
  if (/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text)) {
    return {
      recurrence: null,
      note: null,
      needsWeekdayRule: true,
    };
  }
  return { recurrence: null, note: null, needsWeekdayRule: false };
}

/**
 * Removes the phrases the parser consumed, so they do not leak into the title.
 *
 * Accepts both plain strings and pre-built patterns. Only spans the parser
 * actually resolved are removed: anything left over stays in the title, because
 * an unrecognised fragment is far more likely to be real task content than
 * parser noise.
 */
function stripMatchedPhrases(text: string, spans: (string | RegExp)[]): string {
  let result = text;
  for (const span of spans) {
    if (!span) continue;
    const pattern =
      span instanceof RegExp
        ? new RegExp(span.source, span.flags.replace("g", ""))
        : new RegExp(span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Finds explicit reminder phrases, returning only offsets the app supports.
 *
 * A phrase the application has no option for (e.g. "3 days before") is ignored
 * rather than snapped to the nearest supported value, so no reminder is invented.
 */
export function resolveReminders(text: string): { offsets: number[]; notes: string[] } {
  const offsets: number[] = [];
  const notes: string[] = [];
  const mentioned = /\bremind\s+me\b|\breminder\b|\balert\s+me\b/i.test(text);

  for (const { pattern, offset, label } of REMINDER_PHRASES) {
    if (pattern.test(text) && !offsets.includes(offset)) {
      offsets.push(offset);
      notes.push(`Reminder: ${label}.`);
    }
  }

  // "remind me to X" with no recognised offset falls back to an at-start
  // reminder, but only when no *unsupported* offset was named. "3 days before"
  // is a real request the app cannot express, so nothing is invented for it.
  if (mentioned && offsets.length === 0) {
    const namedUnsupportedOffset =
      /\b\d+\s+(minutes?|hours?|hrs?|days?)\s+before\b/i.test(text);
    if (!namedUnsupportedOffset) {
      offsets.push(REMINDER_OFFSETS.AT_START);
      notes.push("Reminder: at start time (no offset was named).");
    } else {
      notes.push(
        "The reminder offset you described is not one this app offers, so no reminder was set."
      );
    }
  }

  return { offsets, notes };
}

/**
 * Matches the input against the user's EXISTING tags.
 *
 * Returns names only. No tag is ever created here, and the caller must let the
 * user confirm before anything is linked — the parser has no write path at all.
 */
export function matchExistingTags(text: string, existingTagNames: string[]): string[] {
  const haystack = text.toLowerCase();
  return existingTagNames.filter((name) => {
    const trimmed = name.trim().toLowerCase();
    // A one-character tag would match almost any sentence.
    if (trimmed.length < 3) return false;
    return new RegExp(`\\b${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
  });
}

export interface ParseOptions {
  /** The user's IANA timezone. Required: the browser's own zone is never used. */
  timezone: string;
  /** The current date in that timezone (`yyyy-MM-dd`). */
  todayStr: string;
  /** The user's existing tag names, for suggestion only. */
  existingTagNames?: string[];
}

/**
 * Parses natural language into a reviewable draft.
 *
 * This function is pure and performs no I/O of any kind: it never touches the
 * database, never calls a network API, and never creates a task. It returns a
 * draft that the UI must present to the user for review before anything is
 * saved.
 *
 * Anything the parser is not confident about is left unset and listed in
 * `unresolved` instead of being defaulted.
 */
export function parseTaskDraft(input: string, options: ParseOptions): ParsedTaskDraft {
  const text = input.trim();
  const { timezone, todayStr, existingTagNames = [] } = options;

  const date = resolveDate(text, todayStr);
  const time = resolveTime(text);
  const priority = resolvePriority(text);
  const recurrence = resolveRecurrence(text);
  const reminders = resolveReminders(text);
  const suggestedTagNames = matchExistingTags(text, existingTagNames);

  const notes: string[] = [];
  if (priority.note) notes.push(priority.note);
  if (recurrence.note) notes.push(recurrence.note);
  notes.push(...reminders.notes);
  if (time?.approximate) {
    notes.push(`Time was inferred as ${time.time} from "${time.matchedText}".`);
  }
  if (recurrence.needsWeekdayRule) {
    notes.push(
      "A specific weekday repeat is not supported yet, so no repeat was set. Add it manually if you need one."
    );
  }
  if (suggestedTagNames.length > 0) {
    notes.push(`Matched your existing tag${suggestedTagNames.length > 1 ? "s" : ""}: ${suggestedTagNames.join(", ")}.`);
  }

  /*
   * Title: the original text minus only the spans the parser actually resolved.
   * A recogniser that finds nothing leaves the input untouched, so "Buy
   * groceries" keeps its whole phrase as the title.
   */
  const consumed: (string | RegExp)[] = [
    // "remind me to call X" → the "to" is connector noise, not task content.
    /\bremind\s+me\s+to\b/i,
    /\bremind\s+me\b/i,
    /\breminder\b/i,
    /\balert\s+me\b/i,
  ];
  if (date) consumed.push(date.matchedText);
  if (time) consumed.push(time.matchedText);
  for (const { pattern } of REMINDER_PHRASES) {
    const match = pattern.exec(text);
    if (match) consumed.push(match[0]);
  }
  if (recurrence.recurrence) {
    const cadence = /\bevery\s+(day|week|month)\b|\b(daily|weekly|monthly)\b/i.exec(text);
    if (cadence) consumed.push(cadence[0]);
  }

  const rawTitle = stripMatchedPhrases(text, consumed);
  // A draft with no usable title is not reviewable, so fall back to the input.
  const title = rawTitle.length > 0 ? rawTitle : text;

  const draft: TaskDraft = {
    title,
    timezone,
    priority: priority.priority,
    reminderOffsets: reminders.offsets,
    recurrence: recurrence.recurrence,
    suggestedTagNames,
  };

  if (date) draft.taskDate = date.date;
  if (time) {
    draft.startTime = time.time;
    // A single time implies a start; the end is defaulted but always editable.
    draft.endTime = addMinutesToTime(time.time, DEFAULT_DURATION_MINUTES);
  }

  const unresolved: (keyof TaskDraft)[] = [];
  if (!draft.taskDate) unresolved.push("taskDate");
  if (!draft.startTime) unresolved.push("startTime");
  if (!draft.endTime) unresolved.push("endTime");

  return { draft, unresolved, notes };
}



