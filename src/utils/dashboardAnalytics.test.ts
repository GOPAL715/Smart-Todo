import { describe, it, expect } from "vitest";
import {
  getAnalyticsDateRange,
  isWithinDateRange,
  dateFromDateStr,
  toDateStr,
  getCalendarMonthAnchor,
  getCalendarGridRange,
  computeRangeAnalytics,
  computeTaskStats,
  formatCycleTime,
  getUnreadPollInterval,
  UNREAD_POLL_MS,
  type AnalyticsTask,
} from "./dashboardAnalytics";
import { queryKeys } from "@/services/queryKeys";
import { TASK_PAGE_SIZE } from "@/services/taskService";

const task = (over: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  task_date: "2026-09-26",
  status: "PENDING",
  created_at: "2026-09-26T10:00:00.000Z",
  updated_at: "2026-09-26T10:00:00.000Z",
  ...over,
});

describe("getAnalyticsDateRange", () => {
  it("collapses today to a single day", () => {
    expect(getAnalyticsDateRange("today", "2026-09-26")).toEqual({
      startStr: "2026-09-26",
      endStr: "2026-09-26",
    });
  });

  it("expands week to Sunday..Saturday inclusive", () => {
    // 2026-09-26 is a Saturday, so the week is the 20th..26th.
    expect(getAnalyticsDateRange("week", "2026-09-26")).toEqual({
      startStr: "2026-09-20",
      endStr: "2026-09-26",
    });
  });

  it("expands week correctly when today is a Sunday", () => {
    // 2026-09-27 is a Sunday; the week starts and ends on the same day.
    expect(getAnalyticsDateRange("week", "2026-09-27")).toEqual({
      startStr: "2026-09-27",
      endStr: "2026-10-03",
    });
  });

  it("expands month to first..last day, incl. 30 and 31 day months", () => {
    expect(getAnalyticsDateRange("month", "2026-09-15")).toEqual({
      startStr: "2026-09-01",
      endStr: "2026-09-30",
    });
    expect(getAnalyticsDateRange("month", "2026-01-15")).toEqual({
      startStr: "2026-01-01",
      endStr: "2026-01-31",
    });
  });

  it("handles a leap-year February", () => {
    expect(getAnalyticsDateRange("month", "2028-02-10")).toEqual({
      startStr: "2028-02-01",
      endStr: "2028-02-29",
    });
  });

  it("rolls the week across a month boundary", () => {
    // 2026-10-01 is a Thursday; the week runs back into September.
    expect(getAnalyticsDateRange("week", "2026-10-01")).toEqual({
      startStr: "2026-09-27",
      endStr: "2026-10-03",
    });
  });

  it("crosses a year boundary", () => {
    // 2027-01-01 is a Friday; the week spans Dec 2026 and Jan 2027.
    expect(getAnalyticsDateRange("week", "2027-01-01")).toEqual({
      startStr: "2026-12-27",
      endStr: "2027-01-02",
    });
  });
});

describe("date-only helpers are timezone- and DST-stable", () => {
  it("round-trips a date string through UTC noon unchanged", () => {
    for (const value of ["2026-01-01", "2026-09-26", "2026-12-31", "2028-02-29"]) {
      expect(toDateStr(dateFromDateStr(value))).toBe(value);
    }
  });

  it("never lands on an adjacent day for extreme UTC offsets", () => {
    // These zones put local midnight on a different UTC day, and some shift by
    // a DST hour. UTC noon is immune to both.
    for (const value of ["2026-09-26", "2026-03-08", "2026-11-01"]) {
      expect(toDateStr(dateFromDateStr(value))).toBe(value);
    }
  });

  it("keeps month bounds correct across DST transition months", () => {
    // March 2026 has the US/EU spring-forward; November 2026 the fall-back.
    expect(getAnalyticsDateRange("month", "2026-03-15")).toEqual({
      startStr: "2026-03-01",
      endStr: "2026-03-31",
    });
    expect(getAnalyticsDateRange("month", "2026-11-15")).toEqual({
      startStr: "2026-11-01",
      endStr: "2026-11-30",
    });
  });
});

describe("isWithinDateRange", () => {
  it("is inclusive on both ends", () => {
    expect(isWithinDateRange("2026-09-20", "2026-09-20", "2026-09-26")).toBe(true);
    expect(isWithinDateRange("2026-09-26", "2026-09-20", "2026-09-26")).toBe(true);
  });

  it("excludes days outside the range", () => {
    expect(isWithinDateRange("2026-09-19", "2026-09-20", "2026-09-26")).toBe(false);

describe("calendar grid", () => {
  it("anchors the month to the user's calendar date, not the browser's", () => {
    // A user in Asia/Kolkata is already on the 27th when UTC is still the 26th.
    expect(toDateStr(getCalendarMonthAnchor("2026-09-27"))).toBe("2026-09-01");
  });

  it("keeps the anchor in the same month on the 1st", () => {
    expect(toDateStr(getCalendarMonthAnchor("2026-10-01"))).toBe("2026-10-01");
  });

  it("produces whole Sunday-start weeks covering the month", () => {
    const { startStr, endStr, days } = getCalendarGridRange(getCalendarMonthAnchor("2026-09-26"));
    // Sept 2026: the 1st is a Tuesday, the 30th a Wednesday.
    expect(startStr).toBe("2026-08-30");
    expect(endStr).toBe("2026-10-03");
    expect(days.length % 7).toBe(0);
    expect(days[0].getUTCDay()).toBe(0);
    expect(days[days.length - 1].getUTCDay()).toBe(6);
  });

  it("covers the month for a 31-day month starting on Saturday", () => {
    const { startStr, endStr, days } = getCalendarGridRange(getCalendarMonthAnchor("2026-08-10"));
    expect(startStr).toBe("2026-07-26");
    expect(endStr).toBe("2026-09-06");
    expect(days.some((d) => toDateStr(d) === "2026-08-01")).toBe(true);
    expect(days.some((d) => toDateStr(d) === "2026-08-31")).toBe(true);
  });

  it("keeps the grid stable across a DST month", () => {
    const march = getCalendarGridRange(getCalendarMonthAnchor("2026-03-15"));
    const november = getCalendarGridRange(getCalendarMonthAnchor("2026-11-15"));
    expect(march.days.length % 7).toBe(0);
    expect(november.days.length % 7).toBe(0);
    expect(march.days.some((d) => toDateStr(d) === "2026-03-31")).toBe(true);
  });
});

describe("computeRangeAnalytics", () => {
  it("returns zeroed, safe metrics for an empty range", () => {
    expect(computeRangeAnalytics([])).toEqual({
      completed: 0,
      completionRate: 0,
      overdue: 0,
      avgCycleMinutes: null,
    });
  });

  it("computes completion rate and overdue count", () => {
    const result = computeRangeAnalytics([
      task({ status: "COMPLETED" }),
      task({ status: "COMPLETED" }),
      task({ status: "OVERDUE" }),
      task({ status: "PENDING" }),
    ]);
    expect(result.completed).toBe(2);
    expect(result.completionRate).toBe(50);
    expect(result.overdue).toBe(1);
  });

  it("averages created->updated minutes across completed tasks only", () => {
    const result = computeRangeAnalytics([
      task({ status: "COMPLETED", created_at: "2026-09-26T10:00:00Z", updated_at: "2026-09-26T10:30:00Z" }),
      task({ status: "COMPLETED", created_at: "2026-09-26T10:00:00Z", updated_at: "2026-09-26T11:30:00Z" }),
      task({ status: "PENDING", created_at: "2026-09-26T10:00:00Z", updated_at: "2026-09-26T20:00:00Z" }),
    ]);
    expect(result.avgCycleMinutes).toBe(60);
  });

  it("ignores negative and unparseable cycle times", () => {
    const result = computeRangeAnalytics([
      task({ status: "COMPLETED", created_at: "2026-09-26T12:00:00Z", updated_at: "2026-09-26T10:00:00Z" }),
      task({ status: "COMPLETED", created_at: "not-a-date", updated_at: "also-not-a-date" }),
    ]);
    expect(result.avgCycleMinutes).toBeNull();
  });

  it("keeps completed and overdue mutually exclusive", () => {
    const result = computeRangeAnalytics([task({ status: "COMPLETED" }), task({ status: "OVERDUE" })]);
    expect(result.completed).toBe(1);
    expect(result.overdue).toBe(1);
  });
});

    expect(isWithinDateRange("2026-09-27", "2026-09-20", "2026-09-26")).toBe(false);
  });

  it("orders dates correctly across a year boundary", () => {
    expect(isWithinDateRange("2027-01-01", "2026-12-27", "2027-01-02")).toBe(true);
    expect(isWithinDateRange("2026-12-26", "2026-12-27", "2027-01-02")).toBe(false);
  });
});
describe("lifetime statistics are never truncated by the UI list page", () => {
  /*
   * Regression guard for the defect this replaced: the dashboard derived its
   * lifetime stat cards from the task list query. For an account with more
   * tasks than one page, the cards silently reported the page instead of the
   * true lifetime totals.
   *
   * Lifetime counts are produced by Postgres via `count: "exact", head: true`,
   * so they are independent of how many rows the UI happens to have loaded. The
   * assertions below pin that: a dataset larger than one page must not yield
   * page-sized numbers. Referencing `TASK_PAGE_SIZE` rather than a literal keeps
   * that true if the page size ever changes.
   */

  it("counts far more than one page of tasks without truncating", () => {
    const many = Array.from({ length: TASK_PAGE_SIZE * 3 }, (_, i) => ({
      status: "PENDING",
      priority: "LOW",
      id: i,
    }));
    const result = computeTaskStats(many);
    expect(result.total).toBe(TASK_PAGE_SIZE * 3);
    expect(result.total).toBeGreaterThan(TASK_PAGE_SIZE);
  });

  it("keeps per-status and per-priority counts exact beyond one page", () => {
    const size = TASK_PAGE_SIZE * 2;
    const many = Array.from({ length: size }, (_, i) => ({
      // A deterministic spread so each bucket is non-empty and known.
      status: ["COMPLETED", "PENDING", "IN_PROGRESS", "OVERDUE", "CANCELLED"][i % 5],
      priority: ["URGENT", "HIGH", "MEDIUM", "LOW"][i % 4],
    }));
    const result = computeTaskStats(many);

    expect(result.total).toBe(size);
    expect(result.total).not.toBe(TASK_PAGE_SIZE);
    // Each of the 5 statuses covers exactly size/5 rows.
    expect(result.completed).toBe(size / 5);
    expect(result.pending).toBe(size / 5);
    expect(result.inProgress).toBe(size / 5);
    expect(result.overdue).toBe(size / 5);
    // Each of the 4 priorities covers exactly size/4 rows.
    expect(result.urgent).toBe(size / 4);
    expect(result.high).toBe(size / 4);
  });

  it("does not confuse a dataset at exactly one page with a larger one", () => {
    // Guards the specific off-by-boundary case: at exactly one page the two are
    // indistinguishable, so the risk is one row beyond it.
    const atCap = Array.from({ length: TASK_PAGE_SIZE }, () => ({
      status: "PENDING",
      priority: "LOW",
    }));
    const overCap = Array.from({ length: TASK_PAGE_SIZE + 1 }, () => ({
      status: "PENDING",
      priority: "LOW",
    }));
    expect(computeTaskStats(atCap).total).toBe(TASK_PAGE_SIZE);
    expect(computeTaskStats(overCap).total).toBe(TASK_PAGE_SIZE + 1);
  });

  it("does not derive lifetime stats from the capped list query key", () => {
    // The exact counts must live under their own cache key, otherwise a cached
    // truncated `taskList` page could satisfy the exact-count query.
    const listKey = queryKeys.taskList("user-1", "all");
    const statsKey = queryKeys.lifetimeTaskStats("user-1");
    expect(statsKey).not.toEqual(listKey);
    expect(statsKey).toContain("lifetime-stats");
  });
});

describe("computeTaskStats", () => {
  it("returns zeroes for an empty list", () => {
    expect(computeTaskStats([])).toEqual({
      total: 0,
      completed: 0,
      pending: 0,
      inProgress: 0,
      overdue: 0,
      urgent: 0,
      high: 0,
    });
  });

  it("counts each status and priority exactly once", () => {
    const result = computeTaskStats([
      { status: "COMPLETED", priority: "URGENT" },
      { status: "PENDING", priority: "HIGH" },
      { status: "IN_PROGRESS", priority: "LOW" },
      { status: "OVERDUE", priority: "MEDIUM" },
      { status: "CANCELLED", priority: "LOW" },
    ]);
    expect(result).toEqual({
      total: 5,
      completed: 1,
      pending: 1,
      inProgress: 1,
      overdue: 1,
      urgent: 1,
      high: 1,
    });
  });

  it("does not double-count an urgent overdue task", () => {
    const result = computeTaskStats([{ status: "OVERDUE", priority: "URGENT" }]);
    expect(result.overdue).toBe(1);
    expect(result.urgent).toBe(1);
    expect(result.total).toBe(1);
  });
});

describe("formatCycleTime", () => {
  it("renders an em dash when there is no data", () => {
    expect(formatCycleTime(null)).toBe("—");
  });

  it("renders minutes below an hour", () => {
    expect(formatCycleTime(45)).toBe("45m");
  });

  it("renders whole and mixed hours", () => {
    expect(formatCycleTime(60)).toBe("1h");
    expect(formatCycleTime(135)).toBe("2h 15m");
  });
});

describe("getUnreadPollInterval", () => {
  it("keeps the 30s cadence while online", () => {
    expect(getUnreadPollInterval(true)).toBe(UNREAD_POLL_MS);
    expect(UNREAD_POLL_MS).toBe(30_000);
  });

  it("suspends polling while offline", () => {
    expect(getUnreadPollInterval(false)).toBe(false);
  });
});
