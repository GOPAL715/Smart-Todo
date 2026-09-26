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
