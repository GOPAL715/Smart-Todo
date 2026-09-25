import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/supabase", () => ({ supabase: {} }));

import { buildTaskUpdate, getOwnedTasks } from "./taskService";
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
