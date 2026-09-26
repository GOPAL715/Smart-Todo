import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/supabase", () => ({ supabase: {} }));

import { buildTaskUpdate, buildTaskSchedule, getOwnedTasks, calendarRange, groupTasksByDate } from "./taskService";
import type { Task } from "@/types";

describe("buildTaskUpdate", () => {
  it("persists edited reminder offsets", () => {
    const updates = buildTaskUpdate({ reminderOffsets: [30, 10] });
    expect(updates.reminder_offsets).toEqual([30, 10]);
  });

  it("rejects unsupported reminder offsets before persistence", () => {
    expect(() => buildTaskUpdate({ reminderOffsets: [45] })).toThrow("Unsupported reminder offset: 45");
  });

  it("converts an edited wall-clock schedule using its supplied timezone", () => {
    const updates = buildTaskUpdate({
      taskDate: "2026-01-16",
      startTime: "09:00",
      endTime: "10:00",
      timezone: "America/New_York",
    });
    expect(updates.start_datetime).toBe("2026-01-16T14:00:00.000Z");
    expect(updates.end_datetime).toBe("2026-01-16T15:00:00.000Z");
  });

  it("rejects a partial schedule instead of silently dropping it", () => {
    // Regression: a supplied taskDate without times used to be ignored
    // entirely, so the UI showed a change that never persisted.
    expect(() => buildTaskUpdate({ taskDate: "2026-02-01" })).toThrow(
      "A task's date, start time and end time must be provided together."
    );
    expect(() => buildTaskUpdate({ startTime: "09:00" })).toThrow();
    expect(() => buildTaskUpdate({ endTime: "10:00" })).toThrow();
    expect(() => buildTaskUpdate({ taskDate: "2026-02-01", startTime: "09:00" })).toThrow();
  });

  it("leaves non-schedule updates untouched by the schedule rules", () => {
    const updates = buildTaskUpdate({ title: "New title", status: "COMPLETED" });
    expect(updates.title).toBe("New title");
    expect(updates.status).toBe("COMPLETED");
    expect(updates).not.toHaveProperty("task_date");
    expect(updates).not.toHaveProperty("duration_minutes");
  });

  it("writes the schedule columns as one consistent set", () => {
    const updates = buildTaskUpdate({
      taskDate: "2026-03-05",
      startTime: "13:00",
      endTime: "14:30",
      timezone: "UTC",
    });
    expect(updates.task_date).toBe("2026-03-05");
    expect(updates.start_time).toBe("13:00");
    expect(updates.end_time).toBe("14:30");
    expect(updates.start_datetime).toBe("2026-03-05T13:00:00.000Z");
    expect(updates.end_datetime).toBe("2026-03-05T14:30:00.000Z");
    expect(updates.duration_minutes).toBe(90);
  });

  it("rejects a cross-midnight schedule rather than writing a negative duration", () => {
    expect(() =>
      buildTaskUpdate({ taskDate: "2026-03-05", startTime: "23:00", endTime: "01:00" })
    ).toThrow(/next day are not supported/);
  });

  it("rejects an identical start and end", () => {
    expect(() =>
      buildTaskUpdate({ taskDate: "2026-03-05", startTime: "09:00", endTime: "09:00" })
    ).toThrow("Start and end time must be different.");
  });
});

describe("buildTaskSchedule", () => {
  it("computes a positive duration and matching UTC instants", () => {
    const schedule = buildTaskSchedule("2026-04-10", "09:00", "11:30", "UTC");
    expect(schedule.duration_minutes).toBe(150);
    expect(schedule.start_datetime).toBe("2026-04-10T09:00:00.000Z");
    expect(schedule.end_datetime).toBe("2026-04-10T11:30:00.000Z");
    expect(new Date(schedule.end_datetime).getTime()).toBeGreaterThan(
      new Date(schedule.start_datetime).getTime()
    );
  });

  it("respects the supplied timezone", () => {
    const schedule = buildTaskSchedule("2026-04-10", "09:00", "10:00", "Asia/Kolkata");
    expect(schedule.start_datetime).toBe("2026-04-10T03:30:00.000Z");
  });

  it("always yields a strictly positive duration", () => {
    for (const [start, end] of [["00:00", "23:59"], ["00:01", "00:02"], ["09:00", "17:45"]]) {
      const schedule = buildTaskSchedule("2026-04-10", start, end, "UTC");
      expect(schedule.duration_minutes).toBeGreaterThan(0);
    }
  });

  it("rejects malformed times", () => {
    expect(() => buildTaskSchedule("2026-04-10", "9am", "10:00")).toThrow(/HH:mm/);
    expect(() => buildTaskSchedule("2026-04-10", "09:00", "25:00")).toThrow(/HH:mm/);
    expect(() => buildTaskSchedule("2026-04-10", "", "10:00")).toThrow(/HH:mm/);
  });

  it("rejects an invalid date", () => {
    expect(() => buildTaskSchedule("not-a-date", "09:00", "10:00")).toThrow(/valid date/);
  });

  it("rejects cross-midnight input with an explanatory message", () => {
    expect(() => buildTaskSchedule("2026-04-10", "23:00", "01:00")).toThrow(
      "End time must be after start time. Tasks that end the next day are not supported yet."
    );
    expect(() => buildTaskSchedule("2026-04-10", "22:00", "02:00")).toThrow(/next day/);
  });
});

describe("calendarRange", () => {
  it("returns the inclusive first and last date of a day span", () => {
    const days = [new Date(2026, 0, 28), new Date(2026, 0, 29), new Date(2026, 0, 30)];
    expect(calendarRange(days)).toEqual({ start: "2026-01-28", end: "2026-01-30" });
  });

  it("handles a single day", () => {
    expect(calendarRange([new Date(2026, 1, 1)])).toEqual({ start: "2026-02-01", end: "2026-02-01" });
  });

  it("returns null for an empty span", () => {
    expect(calendarRange([])).toBeNull();
  });

  it("spans a month boundary when the grid includes trailing days", () => {
    // A grid that starts in January and runs into March.
    const days = [new Date(2026, 0, 30), new Date(2026, 1, 1), new Date(2026, 1, 2), new Date(2026, 2, 7)];
    expect(calendarRange(days)).toEqual({ start: "2026-01-30", end: "2026-03-07" });
  });
});

describe("groupTasksByDate", () => {
  const task = (id: string, date: string) => ({ id, task_date: date }) as Task;

  it("buckets tasks under their task_date", () => {
    const grouped = groupTasksByDate([
      task("a", "2026-01-16"),
      task("b", "2026-01-17"),
      task("c", "2026-01-16"),
    ]);
    expect(Object.keys(grouped).sort()).toEqual(["2026-01-16", "2026-01-17"]);
    expect(grouped["2026-01-16"].map((t) => t.id)).toEqual(["a", "c"]);
    expect(grouped["2026-01-17"].map((t) => t.id)).toEqual(["b"]);
  });

  it("returns an empty map for no tasks, so every day renders as empty", () => {
    expect(groupTasksByDate([])).toEqual({});
  });

  it("omits days that have no tasks", () => {
    const grouped = groupTasksByDate([task("a", "2026-01-16")]);
    expect(grouped["2026-01-17"]).toBeUndefined();
  });

  it("preserves the incoming order within a day", () => {
    const grouped = groupTasksByDate([
      task("z", "2026-01-16"),
      task("a", "2026-01-16"),
    ]);
    expect(grouped["2026-01-16"].map((t) => t.id)).toEqual(["z", "a"]);
  });
});

describe("getOwnedTasks", () => {
  it("excludes shared tasks from personal metrics", () => {
    const base = { title: "Task" } as Task;
    const tasks = [
      { ...base, id: "owned", user_id: "user-a" },
      { ...base, id: "shared", user_id: "user-b" },
    ];
    expect(getOwnedTasks(tasks, "user-a").map((task) => task.id)).toEqual(["owned"]);
  });
});
