/**
 * Dashboard analytics helpers.
 *
 * Extracted from `DashboardPage` so the metric definitions and the date-range
 * maths are pure and unit-testable, and so the dashboard can compute them from
 * a bounded query instead of re-filtering the user's entire task history.
 *
 * Metric definitions are unchanged from the original implementation; they were
 * extracted, not redesigned.
 */

export type AnalyticsRange = "today" | "week" | "month";

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  today: "today",
  week: "this week",
  month: "this month",
};

/**
 * Inclusive `yyyy-MM-dd` bounds of an analytics range, evaluated in the user's
 * configured timezone.
 *
 * `todayStr` must be the calendar date in the user's zone (from
 * `localDateStr`), never a browser-local date. All arithmetic below is on
 * date-only values at UTC noon, so it never depends on the browser's own offset
 * and cannot be shifted by a DST boundary.
 */
export function getAnalyticsDateRange(
  range: AnalyticsRange,
  todayStr: string
): { startStr: string; endStr: string } {
  const today = dateFromDateStr(todayStr);

  if (range === "today") {
    return { startStr: todayStr, endStr: todayStr };
  }

  if (range === "week") {
    // Week starts Sunday, matching the previous `startOfWeek(..., 0)` behaviour.
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    return { startStr: toDateStr(start), endStr: toDateStr(end) };
  }

  return {
    startStr: toDateStr(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12))),
    endStr: toDateStr(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12))),
  };
}

/** True when `dateStr` falls inside the inclusive range. Both are yyyy-MM-dd. */
export function isWithinDateRange(
  dateStr: string,
  startStr: string,
  endStr: string
): boolean {
  // String comparison is correct and safe for zero-padded ISO dates.
  return dateStr >= startStr && dateStr <= endStr;
}

/**
 * Builds a UTC-noon `Date` from a `yyyy-MM-dd` string.
 *
 * UTC noon is deliberate: a date-only value at local midnight can land on the
 * previous or next calendar day depending on the browser's offset, and near
 * midnight it can be shifted by a DST transition. Noon UTC is never on a
 * boundary for any real-world offset.
 */
export function dateFromDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

/** Formats a UTC-noon `Date` back to `yyyy-MM-dd`. */
export function toDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the calendar month the UI should open on, as a UTC-noon `Date`
 * anchored to the first of that month, derived from the user's timezone.
 *
 * The calendar previously seeded `new Date()` and `new Date(y, m-1, d)`, both
 * interpreted in the *browser's* timezone. A user whose profile timezone differs
 * from the device timezone could land on the wrong month, or see a cell marked
 * "today" that is not today in their zone. `todayStr` must come from
 * `localDateStr(now, userTimezone)`.
 */
export function getCalendarMonthAnchor(todayStr: string): Date {
  return dateFromDateStr(`${todayStr.slice(0, 7)}-01`);
}

/**
 * The inclusive `yyyy-MM-dd` range covered by a month grid, plus the day cells.
 *
 * The grid spans whole weeks, so it can start before the 1st and end after the
 * last day of the month. Returning the true first/last grid dates is what lets
 * the calendar issue one bounded range query covering every visible cell.
 *
 * Day arithmetic is done in UTC on purpose. Using the browser's local `Date`
 * would make the grid depend on the device offset rather than the user's
 * configured timezone, which is the bug this replaces.
 */
export function getCalendarGridRange(
  monthAnchor: Date
): { startStr: string; endStr: string; days: Date[] } {
  const year = monthAnchor.getUTCFullYear();
  const month = monthAnchor.getUTCMonth();

  // Day-of-week for the 1st, in UTC. getUTCDay() is 0=Sunday, which is the
  // same Sunday-start convention the grid already used.
  const firstOfMonth = new Date(Date.UTC(year, month, 1, 12));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstOfMonth.getUTCDay());

  // Last day of month: day 0 of the next month.
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0, 12));
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { startStr: toDateStr(gridStart), endStr: toDateStr(gridEnd), days };
}

/**
 * How the notification queries should poll.
 *
 * The unread badge polled every 30 seconds unconditionally, including while the
 * tab was in the background and while the device was offline, where the request
 * can only fail.
 *
 * - `UNREAD_POLL_MS` is unchanged at 30s, so a badge still updates promptly.
 * - Polling is paused entirely when offline: a request that cannot succeed
 *   costs a failed round trip and a console error every 30 seconds, and there
 *   is nothing useful to update until connectivity returns.
 * - React Query's `refetchIntervalInBackground: false` (applied at the call
 *   site) keeps a backgrounded tab from polling; the existing `staleTime` and
 *   focus refetch still refresh it on return.
 */
export const UNREAD_POLL_MS = 30_000;

/** Resolves the poll interval, or `false` to suspend polling while offline. */
export function getUnreadPollInterval(isOnline: boolean): number | false {
  return isOnline ? UNREAD_POLL_MS : false;
}

export interface AnalyticsTask {
  task_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RangeAnalytics {
  completed: number;
  completionRate: number;
  overdue: number;
  /** Mean created→updated minutes across completed tasks, or null if none. */
  avgCycleMinutes: number | null;
}

/**
 * Computes the productivity metrics for a set of tasks.
 *
 * Ownership filtering is the caller's job: the caller passes only tasks it has
 * already established are its own, preserving the existing rule that shared
 * tasks never contribute to personal metrics.
 */
export function computeRangeAnalytics(tasks: AnalyticsTask[]): RangeAnalytics {
  let completed = 0;
  let overdue = 0;
  let cycleTotal = 0;
  let cycleCount = 0;

  for (const task of tasks) {
    if (task.status === "COMPLETED") {
      completed++;
      const minutes = (Date.parse(task.updated_at) - Date.parse(task.created_at)) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        cycleTotal += minutes;
        cycleCount++;
      }
    } else if (task.status === "OVERDUE") {
      overdue++;
    }
  }

  return {
    completed,
    completionRate: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
    overdue,
    avgCycleMinutes: cycleCount > 0 ? Math.round(cycleTotal / cycleCount) : null,
  };
}

/** Formats an average cycle time, or an em dash when there is no data. */
export function formatCycleTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The five lifetime stat-card counts, computed in a single pass. */
export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  overdue: number;
  urgent: number;
  high: number;
}

/**
 * Single-pass lifetime counts.
 *
 * The previous implementation ran seven separate `Array.filter` passes over the
 * whole task list; this walks once, which matters because the list is unbounded.
 */
export function computeTaskStats(tasks: { status: string; priority: string }[]): TaskStats {
  const stats: TaskStats = {
    total: 0,
    completed: 0,
    pending: 0,
    inProgress: 0,
    overdue: 0,
    urgent: 0,
    high: 0,
  };

  for (const task of tasks) {
    stats.total++;
    if (task.status === "COMPLETED") stats.completed++;
    else if (task.status === "PENDING") stats.pending++;
    else if (task.status === "IN_PROGRESS") stats.inProgress++;
    else if (task.status === "OVERDUE") stats.overdue++;

    if (task.priority === "URGENT") stats.urgent++;
    else if (task.priority === "HIGH") stats.high++;
  }

  return stats;
}
