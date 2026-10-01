/**
 * Wall-clock time input validation.
 *
 * The task form uses `<input type="time">`, whose value is always `HH:mm`, but
 * the value is still validated before being sent: the database stores
 * `start_time` / `end_time` as free text and derives `duration_minutes` from
 * them, so a malformed value would be persisted and only fail later against a
 * CHECK constraint with an opaque error.
 */

/** True when `time` is a valid `HH:mm` wall-clock time. */
export function isValidTimeInput(time: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/** Minutes past midnight for a `HH:mm` string, or null when malformed. */
export function timeToMinutes(time: string): number | null {
  if (!isValidTimeInput(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Default duration for a task that has a start but no usable end.
 *
 * This is not a new rule: the task form has always defaulted to 16:00 -> 17:00,
 * and the natural-language parser defaults a single named time to the same
 * length. Both entry points share it so they cannot drift apart.
 */
export const DEFAULT_DURATION_MINUTES = 60;

/** Adds minutes to an `HH:mm` string, clamping within the day. */
export function addMinutesToTime(time: string, minutes: number): string {
  const base = timeToMinutes(time);
  if (base === null) return time;
  const total = Math.min(23 * 60 + 59, base + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Keeps a start/end pair usable when the user moves the start time.
 *
 * The form opens with fixed defaults, so raising the start past the default end
 * left a stale end behind. `validateTimeRange` then rejected the form with a
 * cross-midnight message for a task the user never asked to span midnight.
 *
 * The end is only touched when it has actually become invalid:
 * - a valid end the user chose is always preserved, even a long one;
 * - a malformed end is left alone so validation still reports it;
 * - a start so late that no same-day end exists (23:59) is also left alone,
 *   because cross-midnight tasks are genuinely unsupported and inventing an end
 *   would either be invalid or weaken the existing rules.
 */
export function reconcileEndTime(startTime: string, endTime: string): string {
  if (!isValidTimeInput(startTime) || !isValidTimeInput(endTime)) return endTime;

  const start = timeToMinutes(startTime) as number;
  const end = timeToMinutes(endTime) as number;

  // Already valid: the user's own end time wins, whatever its length.
  if (end > start) return endTime;

  const suggested = addMinutesToTime(startTime, DEFAULT_DURATION_MINUTES);
  const suggestedMinutes = timeToMinutes(suggested) as number;

  return suggestedMinutes > start ? suggested : endTime;
}

export type TimeRangeError = {
  field: "startTime" | "endTime";
  message: string;
};

/**
 * Validates a start/end time pair.
 *
 * Cross-midnight tasks are not supported: the schema requires
 * `end_datetime > start_datetime` and `duration_minutes > 0`, so an end time
 * earlier than the start time cannot be represented. Validated here so the user
 * gets an actionable message rather than a database error.
 */
export function validateTimeRange(
  startTime: string,
  endTime: string
): { valid: true } | ({ valid: false } & TimeRangeError) {
  if (!isValidTimeInput(startTime)) {
    return { valid: false, field: "startTime", message: "Start time must be a valid time" };
  }
  if (!isValidTimeInput(endTime)) {
    return { valid: false, field: "endTime", message: "End time must be a valid time" };
  }

  const start = timeToMinutes(startTime) as number;
  const end = timeToMinutes(endTime) as number;

  if (start === end) {
    return {
      valid: false,
      field: "endTime",
      message: "Start and end time must be different",
    };
  }
  if (end < start) {
    return {
      valid: false,
      field: "endTime",
      message:
        "End time must be after start time. Tasks that end the next day are not supported yet.",
    };
  }
  return { valid: true };
}
