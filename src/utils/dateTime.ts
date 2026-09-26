import {
  format,
  parseISO,
  differenceInMinutes,
  addMinutes,
  subMinutes,
  isBefore,
  isAfter,
  set,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

export { toZonedTime, fromZonedTime };

export const RECURRENCE_LABELS: Record<string, string> = {
  DAILY: "Repeats daily",
  WEEKLY: "Repeats weekly",
  MONTHLY: "Repeats monthly",
};

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** IANA zones offered in the timezone preference picker. */
export const TIMEZONE_OPTIONS: string[] = [
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export const REMINDER_OFFSETS: Record<string, number> = {
  ONE_DAY: 1440,
  TWO_HOURS: 120,
  ONE_HOUR: 60,
  THIRTY_MINUTES: 30,
  FIFTEEN_MINUTES: 15,
  TEN_MINUTES: 10,
  FIVE_MINUTES: 5,
  AT_START: 0,
};

export const REMINDER_LABELS: Record<string, string> = {
  ONE_DAY: "1 day before",
  TWO_HOURS: "2 hours before",
  ONE_HOUR: "1 hour before",
  THIRTY_MINUTES: "30 minutes before",
  FIFTEEN_MINUTES: "15 minutes before",
  TEN_MINUTES: "10 minutes before",
  FIVE_MINUTES: "5 minutes before",
  AT_START: "At start time",
  NOT_STARTED: "Not started check (10 min after start)",
  OVERDUE: "Overdue check (at end time)",
};

export function toUtcIso(
  date: Date,
  time: string,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const [hours, minutes] = time.split(":").map(Number);
  const localDateTime = set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
  return fromZonedTime(localDateTime, timezone).toISOString();
}

export function fromUtcToZoned(
  isoString: string,
  timezone: string = DEFAULT_TIMEZONE
): Date {
  return toZonedTime(parseISO(isoString), timezone);
}

export function formatTime(isoString: string, timezone: string = DEFAULT_TIMEZONE): string {
  return format(fromUtcToZoned(isoString, timezone), "h:mm a");
}

export function formatDate(isoString: string, timezone: string = DEFAULT_TIMEZONE): string {
  return format(fromUtcToZoned(isoString, timezone), "d MMMM yyyy");
}

export function formatDateTime(isoString: string, timezone: string = DEFAULT_TIMEZONE): string {
  return format(fromUtcToZoned(isoString, timezone), "d MMM yyyy, h:mm a");
}

export function getDurationLabel(startIso: string, endIso: string): string {
  const mins = differenceInMinutes(parseISO(endIso), parseISO(startIso));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function calculateReminderTime(
  startIso: string,
  offsetMinutes: number
): string {
  const result = offsetMinutes === 0 ? parseISO(startIso) : subMinutes(parseISO(startIso), offsetMinutes);
  return result.toISOString();
}

export function isStartTimeBeforeEndTime(
  date: Date,
  startTime: string,
  endTime: string
): boolean {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startTotal = sh * 60 + sm;
  const endTotal = eh * 60 + em;
  return startTotal < endTotal;
}

export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

/** How far back a start time may be before it is described as past-due rather than started. */
const RECENTLY_STARTED_MINUTES = 30;

/**
 * Human-readable countdown to (or state after) a task's start time.
 *
 * The past branch used to return "Started" for *any* earlier instant, so a task
 * scheduled for last week read exactly like one that began a minute ago. Past
 * starts are now split by how long ago they were: only a genuinely recent start
 * is "Started", and anything older reads as past-due ("Started 2 days ago").
 *
 * Only presentation changes here; the underlying instant comparison is untouched
 * and remains timezone-safe (it compares absolute instants).
 */
export function getRelativeTimeLabel(startIso: string, now: Date = new Date()): string {
  const start = parseISO(startIso);
  const diffMins = differenceInMinutes(start, now);

  if (diffMins > 0) {
    if (diffMins < 60) return `Starts in ${diffMins} min`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (mins === 0) return `Starts in ${hours} hr`;
    return `Starts in ${hours} hr ${mins} min`;
  }

  if (diffMins === 0) return "Starting now";

  // diffMins is negative: the start time is in the past.
  const minsAgo = Math.abs(diffMins);
  if (minsAgo <= RECENTLY_STARTED_MINUTES) return "Started";

  const elapsed = formatDuration(minsAgo);
  return `Started ${elapsed} ago`;
}

/** Renders a positive minute count as a compact "2 days"/"3 hr"/"45 min" phrase. */
function formatDuration(totalMins: number): string {
  const days = Math.floor(totalMins / (60 * 24));
  if (days >= 1) {
    const hours = Math.floor((totalMins % (60 * 24)) / 60);
    return hours === 0 ? `${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ${hours} hr`;
  }

  const hours = Math.floor(totalMins / 60);
  if (hours >= 1) {
    const mins = totalMins % 60;
    return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
  }

  return `${totalMins} min`;
}

export function getCalendarDays(monthDate: Date): Date[] {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
}

export {
  format,
  parseISO,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  isBefore,
  isAfter,
  addMinutes,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
};

/** A date-only key for calendar grids; the Date already represents a local calendar day. */
export function calendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calendar date (`YYYY-MM-DD`) of an instant as observed in the given IANA
 * timezone. Uses `Intl` instead of `toISOString()` so the result never
 * depends on the browser's own timezone; invalid zones fall back to the
 * default timezone.
 */
export function localDateStr(date: Date, timezone: string): string {
  const formatter = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  try {
    return formatter(timezone).format(date);
  } catch {
    return formatter(DEFAULT_TIMEZONE).format(date);
  }
}
