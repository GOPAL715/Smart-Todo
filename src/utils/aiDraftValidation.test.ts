import { describe, it, expect } from "vitest";
import {
  validateAiDraft,
  mergeAiDraft,
  isValidIsoDate,
  isValidHhMm,
  isValidTimezoneName,
  SUPPORTED_REMINDER_OFFSETS,
} from "@/utils/aiDraftValidation";
import { parseTaskDraft, type ParseOptions } from "@/utils/taskDraftParser";
import { REMINDER_OFFSETS } from "@/utils/dateTime";
import type { ParsedTaskDraft } from "@/types";

const OPTIONS: ParseOptions = {
  timezone: "Asia/Kolkata",
  todayStr: "2026-09-26",
  existingTagNames: ["assignment"],
};

function deterministic(input: string): ParsedTaskDraft {
  return parseTaskDraft(input, OPTIONS);
}

describe("isValidIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidIsoDate("2026-09-27")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects impossible dates and malformed strings", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("27-09-2026")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("isValidHhMm", () => {
  it("accepts 24-hour times", () => {
    expect(isValidHhMm("00:00")).toBe(true);
    expect(isValidHhMm("18:30")).toBe(true);
    expect(isValidHhMm("23:59")).toBe(true);
  });

  it("rejects out-of-range and malformed times", () => {
    expect(isValidHhMm("24:00")).toBe(false);
    expect(isValidHhMm("12:60")).toBe(false);
    expect(isValidHhMm("6 PM")).toBe(false);
    expect(isValidHhMm("18:5")).toBe(false);
  });
});

describe("isValidTimezoneName", () => {
  it("accepts real IANA zones and rejects nonsense", () => {
    expect(isValidTimezoneName("Asia/Kolkata")).toBe(true);
    expect(isValidTimezoneName("America/New_York")).toBe(true);
    expect(isValidTimezoneName("Not/AZone")).toBe(false);
    expect(isValidTimezoneName("")).toBe(false);
    expect(isValidTimezoneName("x".repeat(200))).toBe(false);
  });
});

describe("validateAiDraft — valid input", () => {
  it("keeps a well-formed response", () => {
    const result = validateAiDraft({
      title: "Call Rahul",
      start_date: "2026-09-27",
      start_time: "18:00",
      priority: "HIGH",
      recurrence: "WEEKLY",
      reminder_offset_minutes: 15,
    });

    expect(result.title).toBe("Call Rahul");
    expect(result.taskDate).toBe("2026-09-27");
    expect(result.startTime).toBe("18:00");
    expect(result.priority).toBe("HIGH");
    expect(result.recurrence).toBe("WEEKLY");
    expect(result.reminderOffset).toBe(15);
    expect(result.rejections).toEqual([]);
  });
});

describe("validateAiDraft — hostile input", () => {
  it("rejects a non-object response", () => {
    expect(validateAiDraft("just some prose").title).toBe("");
    expect(validateAiDraft(null).title).toBe("");
    expect(validateAiDraft(["a"]).title).toBe("");
  });

  it("rejects an empty or missing title", () => {
    expect(validateAiDraft({}).title).toBe("");
    expect(validateAiDraft({ title: "   " }).title).toBe("");
    expect(validateAiDraft({ title: 42 }).title).toBe("");
  });

  it("rejects an invalid priority rather than coercing it", () => {
    const result = validateAiDraft({ title: "Task", priority: "SUPER_URGENT" });
    expect(result.priority).toBeUndefined();
    expect(result.rejections.join(" ")).toMatch(/priority/i);
  });

  it("rejects an unsupported reminder offset and does NOT snap it", () => {
    const result = validateAiDraft({ title: "Task", reminder_offset_minutes: 4320 });
    expect(result.reminderOffset).toBeUndefined();
    expect(result.rejections.join(" ")).toMatch(/reminder/i);
  });

  it("accepts every reminder offset the application supports", () => {
    for (const offset of SUPPORTED_REMINDER_OFFSETS) {
      expect(validateAiDraft({ title: "T", reminder_offset_minutes: offset }).reminderOffset).toBe(
        offset
      );
    }
  });

  it("rejects an invalid recurrence", () => {
    const result = validateAiDraft({ title: "Task", recurrence: "FORTNIGHTLY" });
    expect(result.recurrence).toBeNull();
    expect(result.rejections.join(" ")).toMatch(/repeat/i);
  });

  it("rejects invalid dates and times", () => {
    const result = validateAiDraft({
      title: "Task",
      start_date: "2026-02-30",
      start_time: "25:00",
    });
    expect(result.taskDate).toBeUndefined();
    expect(result.startTime).toBeUndefined();
  });

  it("rejects an end time that is not after the start time", () => {
    const result = validateAiDraft({ title: "Task", start_time: "10:00", end_time: "09:00" });
    expect(result.endTime).toBeUndefined();
    expect(result.rejections.join(" ")).toMatch(/end time/i);
  });

  it("strips unexpected fields such as user_id and task_id", () => {
    const result = validateAiDraft({
      title: "Task",
      user_id: "00000000-0000-0000-0000-000000000000",
      task_id: "11111111-1111-1111-1111-111111111111",
      created_at: "2026-01-01T00:00:00Z",
      sql: "DROP TABLE tasks",
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("user_id");
    expect(serialised).not.toContain("task_id");
    expect(serialised).not.toContain("DROP TABLE");
    expect(result.title).toBe("Task");
  });

  it("truncates oversized strings", () => {
    const result = validateAiDraft({ title: "x".repeat(5000), description: "y".repeat(9000) });
    expect(result.title.length).toBeLessThanOrEqual(200);
    expect(result.description?.length).toBeLessThanOrEqual(2000);
  });
});

describe("mergeAiDraft — deterministic wins", () => {
  it("keeps the date and time the user actually stated", () => {
    // The model prefers a different day and hour; it must not win.
    const ai = validateAiDraft({
      title: "Call Rahul",
      start_date: "2026-10-05",
      start_time: "09:00",
    });
    const merged = mergeAiDraft(ai, deterministic("Call Rahul tomorrow at 6 PM"), OPTIONS);

    expect(merged.draft.taskDate).toBe("2026-09-27");
    expect(merged.draft.startTime).toBe("18:00");
  });

  it("fills a gap the deterministic parser could not resolve", () => {
    const ai = validateAiDraft({ title: "Buy milk", start_date: "2026-09-28" });
    const merged = mergeAiDraft(ai, deterministic("Buy milk"), OPTIONS);
    expect(merged.draft.taskDate).toBe("2026-09-28");
  });

  it("carries the application timezone, not one from the model", () => {
    const ai = validateAiDraft({ title: "Task", timezone: "America/Los_Angeles" });
    const merged = mergeAiDraft(ai, deterministic("Task"), OPTIONS);
    expect(merged.draft.timezone).toBe("Asia/Kolkata");
  });

  it("surfaces rejections and notes to the review screen", () => {
    const ai = validateAiDraft({
      title: "Task",
      priority: "NOPE",
      reminder_offset_minutes: 999,
    });
    const merged = mergeAiDraft(ai, deterministic("Task"), OPTIONS);
    expect(merged.notes.length).toBeGreaterThanOrEqual(2);
  });

  it("only suggests tags the user already owns", () => {
    const ai = validateAiDraft({
      title: "Finish the assignment",
      description: "invented tag: banana",
    });
    const merged = mergeAiDraft(ai, deterministic("Finish the assignment"), {
      timezone: "Asia/Kolkata",
      existingTagNames: ["assignment"],
    });
    expect(merged.draft.suggestedTagNames).toEqual(["assignment"]);
    expect(merged.draft.suggestedTagNames).not.toContain("banana");
  });
});

describe("domain parity with the application", () => {
  it("mirrors the real reminder offsets", () => {
    expect([...SUPPORTED_REMINDER_OFFSETS].sort((a, b) => a - b)).toEqual(
      Object.values(REMINDER_OFFSETS).sort((a, b) => a - b)
    );
  });
});
