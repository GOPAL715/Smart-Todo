import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  calculateReminderTime,
  formatTime,
  getDurationLabel,
  getGreeting,
  getRelativeTimeLabel,
  isStartTimeBeforeEndTime,
  calendarDateKey,
  localDateStr,
  toUtcIso,
} from "./dateTime";

describe("calendarDateKey", () => {
  it("uses local calendar fields without converting through UTC", () => {
    const localDay = new Date(2026, 0, 16, 0, 30);
    expect(calendarDateKey(localDay)).toBe("2026-01-16");
  });
});

describe("localDateStr", () => {
  const instant = new Date("2026-01-15T19:30:00Z");

  it("formats as YYYY-MM-DD in the requested timezone", () => {
    expect(localDateStr(instant, "Asia/Kolkata")).toBe("2026-01-16"); // IST is UTC+5:30 → next day
    expect(localDateStr(instant, "America/New_York")).toBe("2026-01-15"); // EST is UTC-5 → same day
    expect(localDateStr(instant, "UTC")).toBe("2026-01-15");
  });

  it("always matches the YYYY-MM-DD shape regardless of browser locale", () => {
    expect(localDateStr(instant, "Asia/Kolkata")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the default timezone for an invalid zone", () => {
    expect(localDateStr(instant, "Not/AZone")).toBe(localDateStr(instant, DEFAULT_TIMEZONE));
  });

  it("keeps midnight dates stable across the requested timezone", () => {
    const justAfterMidnightUtc = new Date("2026-01-16T00:15:00Z");
    expect(localDateStr(justAfterMidnightUtc, "UTC")).toBe("2026-01-16");
    expect(localDateStr(justAfterMidnightUtc, "America/New_York")).toBe("2026-01-15");
    expect(localDateStr(justAfterMidnightUtc, "Asia/Kolkata")).toBe("2026-01-16");
  });
});

describe("formatTime", () => {
  it("renders UTC instants in the requested timezone", () => {
    expect(formatTime("2026-01-15T19:30:00Z", "Asia/Kolkata")).toBe("1:00 AM"); // 2026-01-16 01:00 IST
    expect(formatTime("2026-01-15T19:30:00Z", "UTC")).toBe("7:30 PM");
  });

  it("defaults to Asia/Kolkata when no timezone is given", () => {
    expect(formatTime("2026-01-15T19:30:00Z")).toBe(formatTime("2026-01-15T19:30:00Z", DEFAULT_TIMEZONE));
  });
});

describe("toUtcIso", () => {
  const date = new Date(2026, 0, 15);

  it("converts wall-clock time in the given timezone to a UTC ISO string", () => {
    expect(toUtcIso(date, "09:00", "Asia/Kolkata")).toBe("2026-01-15T03:30:00.000Z");
    expect(toUtcIso(date, "09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
  });

  it("defaults to Asia/Kolkata", () => {
    expect(toUtcIso(date, "09:00")).toBe("2026-01-15T03:30:00.000Z");
  });
});

describe("isStartTimeBeforeEndTime", () => {
  it("compares HH:mm times", () => {
    const date = new Date(2026, 0, 15);
    expect(isStartTimeBeforeEndTime(date, "09:00", "10:00")).toBe(true);
    expect(isStartTimeBeforeEndTime(date, "09:00", "09:00")).toBe(false);
    expect(isStartTimeBeforeEndTime(date, "23:00", "01:00")).toBe(false);
  });
});

describe("getDurationLabel", () => {
  it("labels minutes and hours between two instants", () => {
    expect(getDurationLabel("2026-01-15T09:00:00Z", "2026-01-15T09:30:00Z")).toBe("30 min");
    expect(getDurationLabel("2026-01-15T09:00:00Z", "2026-01-15T11:00:00Z")).toBe("2 hr");
    expect(getDurationLabel("2026-01-15T09:00:00Z", "2026-01-15T10:30:00Z")).toBe("1 hr 30 min");
  });
});

describe("calculateReminderTime", () => {
  it("subtracts the offset from the start time, or returns start for offset 0", () => {
    expect(calculateReminderTime("2026-01-15T09:30:00.000Z", 30)).toBe("2026-01-15T09:00:00.000Z");
    expect(calculateReminderTime("2026-01-15T09:30:00.000Z", 0)).toBe("2026-01-15T09:30:00.000Z");
  });
});

describe("getGreeting", () => {
  it("greets by hour of day", () => {
    expect(getGreeting(new Date(2026, 0, 15, 9))).toBe("Good morning");
    expect(getGreeting(new Date(2026, 0, 15, 13))).toBe("Good afternoon");
    expect(getGreeting(new Date(2026, 0, 15, 18))).toBe("Good evening");
    expect(getGreeting(new Date(2026, 0, 15, 23))).toBe("Good night");
  });
});

describe("getRelativeTimeLabel", () => {
  const now = new Date("2026-01-15T09:00:00Z");

  it("describes a future start", () => {
    expect(getRelativeTimeLabel("2026-01-15T09:10:00Z", now)).toBe("Starts in 10 min");
    expect(getRelativeTimeLabel("2026-01-15T11:00:00Z", now)).toBe("Starts in 2 hr");
    expect(getRelativeTimeLabel("2026-01-15T11:30:00Z", now)).toBe("Starts in 2 hr 30 min");
  });

  it("reports a start happening right now", () => {
    expect(getRelativeTimeLabel("2026-01-15T09:00:00Z", now)).toBe("Starting now");
  });

  it("says Started for a recently started task", () => {
    // Within the recently-started window.
    expect(getRelativeTimeLabel("2026-01-15T08:59:00Z", now)).toBe("Started");
    expect(getRelativeTimeLabel("2026-01-15T08:45:00Z", now)).toBe("Started");
    expect(getRelativeTimeLabel("2026-01-15T08:30:00Z", now)).toBe("Started");
  });

  it("no longer says Started for a substantially past start", () => {
    // Regression: any past instant used to return "Started", so a task from
    // last week read the same as one that began a minute ago.
    expect(getRelativeTimeLabel("2026-01-15T08:29:00Z", now)).toBe("Started 31 min ago");
    expect(getRelativeTimeLabel("2026-01-15T07:00:00Z", now)).toBe("Started 2 hr ago");
    expect(getRelativeTimeLabel("2026-01-15T06:30:00Z", now)).toBe("Started 2 hr 30 min ago");
    expect(getRelativeTimeLabel("2026-01-14T09:00:00Z", now)).toBe("Started 1 day ago");
    expect(getRelativeTimeLabel("2026-01-12T09:00:00Z", now)).toBe("Started 3 days ago");
    expect(getRelativeTimeLabel("2025-12-12T09:00:00Z", now)).toBe("Started 34 days ago");
  });

  it("handles the boundary at exactly 30 minutes past", () => {
    // 30 min is still "Started"; 31 min switches to a past-due phrase.
    expect(getRelativeTimeLabel("2026-01-15T08:30:00Z", now)).toBe("Started");
    expect(getRelativeTimeLabel("2026-01-15T08:29:00Z", now)).toBe("Started 31 min ago");
  });

  it("handles the boundary at exactly one hour in the future", () => {
    expect(getRelativeTimeLabel("2026-01-15T09:59:00Z", now)).toBe("Starts in 59 min");
    expect(getRelativeTimeLabel("2026-01-15T10:00:00Z", now)).toBe("Starts in 1 hr");
  });

  it("handles sub-minute and zero differences", () => {
    // differenceInMinutes truncates, so a start seconds ago reads as "Starting now".
    expect(getRelativeTimeLabel("2026-01-15T09:00:30Z", now)).toBe("Starting now");
  });
});


/*
 * DST regression coverage for America/New_York.
 *
 * The date/time helpers were never changed by Phase 14A; these tests exist to
 * prove the timezone-switching fix did not alter their behaviour, and to pin the
 * spring-forward boundary that Asia/Kolkata (no DST) cannot exercise.
 *
 * 2026 US DST begins Sunday 2026-03-08 at 02:00 local: 02:00-02:59 never occurs,
 * and UTC-5 (EST) becomes UTC-4 (EDT) for every later instant that day.
 */
describe("DST spring forward in America/New_York", () => {
  it("uses the pre-transition offset before the boundary", () => {
    // 2026-03-07 is still EST (UTC-5).
    expect(toUtcIso(new Date(2026, 2, 7), "12:00", "America/New_York")).toBe(
      "2026-03-07T17:00:00.000Z"
    );
  });

  it("uses the post-transition offset after the boundary", () => {
    // 2026-03-08 is EDT (UTC-4), so the same wall clock is one hour earlier in UTC.
    expect(toUtcIso(new Date(2026, 2, 8), "12:00", "America/New_York")).toBe(
      "2026-03-08T16:00:00.000Z"
    );
  });

  it("resolves instants either side of the boundary to the correct local time", () => {
    // 06:30Z is 01:30 EST; 07:30Z is 03:30 EDT. The 02:00 hour is skipped.
    expect(formatTime("2026-03-08T06:30:00Z", "America/New_York")).toBe("1:30 AM");
    expect(formatTime("2026-03-08T07:30:00Z", "America/New_York")).toBe("3:30 AM");
  });

  it("keeps the calendar day correct for an instant just after local midnight", () => {
    // 04:30Z on 2026-03-08 is still 23:30 on 2026-03-07 in New York.
    expect(localDateStr(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
    // One hour later the local date rolls over.
    expect(localDateStr(new Date("2026-03-08T05:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });

  it("agrees with a DST-free zone on the same wall-clock conversion", () => {
    // Asia/Kolkata has no DST, so 12:00 there is a constant UTC+5:30 year-round.
    // Confirms the two zones are genuinely treated differently rather than one
    // offset being applied to both.
    expect(toUtcIso(new Date(2026, 2, 8), "12:00", "Asia/Kolkata")).toBe(
      "2026-03-08T06:30:00.000Z"
    );
  });

  it("round-trips a post-transition wall clock back to the same local time", () => {
    const iso = toUtcIso(new Date(2026, 2, 8), "09:00", "America/New_York");
    expect(formatTime(iso, "America/New_York")).toBe("9:00 AM");
    expect(localDateStr(new Date(iso), "America/New_York")).toBe("2026-03-08");
  });

  it("keeps a recurring 09:00 task at 09:00 local across the transition", () => {
    // The wall clock must not drift just because the UTC offset changed, which
    // is what the server-side recurrence generator relies on.
    const beforeTransition = toUtcIso(new Date(2026, 2, 7), "09:00", "America/New_York");
    const afterTransition = toUtcIso(new Date(2026, 2, 8), "09:00", "America/New_York");

    expect(formatTime(beforeTransition, "America/New_York")).toBe("9:00 AM");
    expect(formatTime(afterTransition, "America/New_York")).toBe("9:00 AM");
    // The UTC instants are 23 hours apart, not 24: the local day is still 24h.
    expect(new Date(afterTransition).getTime() - new Date(beforeTransition).getTime()).toBe(
      23 * 60 * 60 * 1000
    );
  });
});
