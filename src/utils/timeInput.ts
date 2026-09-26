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
