import { describe, it, expect } from "vitest";
import {
  parseTaskDraft,
  resolveDate,
  resolveTime,
  resolvePriority,
  resolveRecurrence,
  resolveReminders,
  matchExistingTags,
} from "./taskDraftParser";
import { REMINDER_OFFSETS } from "./dateTime";

/** 2026-09-26 is a Saturday. */
const TODAY = "2026-09-26";
const parse = (text: string, existingTagNames: string[] = []) =>
  parseTaskDraft(text, { timezone: "Asia/Kolkata", todayStr: TODAY, existingTagNames });

describe("resolveDate", () => {
  it("resolves today and tomorrow", () => {
    expect(resolveDate("do it today", TODAY)?.date).toBe("2026-09-26");
    expect(resolveDate("do it tomorrow", TODAY)?.date).toBe("2026-09-27");
  });

  it("treats tonight and this evening as the current day", () => {
    expect(resolveDate("call tonight", TODAY)?.date).toBe("2026-09-26");
    expect(resolveDate("call this evening", TODAY)?.date).toBe("2026-09-26");
  });

  it("resolves weekdays to the next occurrence, never today", () => {
    // Today is Saturday, so Monday is two days out.
    expect(resolveDate("standup Monday", TODAY)?.date).toBe("2026-09-28");
    // Naming today's weekday means the coming one, not the one under way.
    expect(resolveDate("gym Saturday", TODAY)?.date).toBe("2026-10-03");
  });

  it("resolves 'in N days'", () => {
    expect(resolveDate("submit in 3 days", TODAY)?.date).toBe("2026-09-29");
  });

  it("returns null for an unrecognised date instead of guessing", () => {
    expect(resolveDate("do the thing someday", TODAY)).toBeNull();
    expect(resolveDate("do the thing", TODAY)).toBeNull();
  });

  it("crosses month and year boundaries correctly", () => {
    expect(resolveDate("due tomorrow", "2026-12-31")?.date).toBe("2027-01-01");
    expect(resolveDate("due in 2 days", "2026-01-30")?.date).toBe("2026-02-01");
  });
});

describe("resolveTime", () => {
  it("resolves 12-hour times with a meridiem", () => {
    expect(resolveTime("at 6 PM")?.time).toBe("18:00");
    expect(resolveTime("at 6:30 pm")?.time).toBe("18:30");
    expect(resolveTime("at 9 AM")?.time).toBe("09:00");
    expect(resolveTime("at 12 AM")?.time).toBe("00:00");
    expect(resolveTime("at 12 PM")?.time).toBe("12:00");
  });

  it("resolves 24-hour times", () => {
    expect(resolveTime("at 18:00")?.time).toBe("18:00");
    expect(resolveTime("at 9")?.time).toBe("09:00");
  });

  it("flags parts of day as approximate", () => {
    expect(resolveTime("tomorrow morning")?.approximate).toBe(true);
    expect(resolveTime("at 6 PM")?.approximate).toBe(false);
  });

  it("returns null when no time is named", () => {
    expect(resolveTime("call Rahul")).toBeNull();
  });

  it("rejects an out-of-range clock value", () => {
    // 25:00 is not a real time, so it must not be accepted as one.
    expect(resolveTime("at 25:00")?.time).not.toBe("25:00");
  });
});

describe("resolvePriority", () => {
  it("suggests URGENT for unambiguous urgency", () => {
    expect(resolvePriority("urgent production issue").priority).toBe("URGENT");
    expect(resolvePriority("ASAP please").priority).toBe("URGENT");
  });

  it("suggests HIGH for high-priority wording", () => {
    expect(resolvePriority("high priority task").priority).toBe("HIGH");
    expect(resolvePriority("finish assignment today").priority).toBe("HIGH");
  });

  it("defaults to MEDIUM when nothing indicates urgency", () => {
    expect(resolvePriority("buy groceries").priority).toBe("MEDIUM");
  });
});

describe("resolveRecurrence", () => {
  it("detects every day, week, and month", () => {
    expect(resolveRecurrence("every day").recurrence).toBe("DAILY");
    expect(resolveRecurrence("every week").recurrence).toBe("WEEKLY");
    expect(resolveRecurrence("every month").recurrence).toBe("MONTHLY");
  });

  it("does not guess a weekday-specific repeat", () => {
    const result = resolveRecurrence("every Monday");
    expect(result.recurrence).toBeNull();
    expect(result.needsWeekdayRule).toBe(true);
  });
});

describe("resolveReminders", () => {
  it("maps supported phrases onto existing offsets", () => {
    expect(resolveReminders("remind me one hour before").offsets).toEqual([
      REMINDER_OFFSETS.ONE_HOUR,
    ]);
    expect(resolveReminders("remind me 10 minutes before").offsets).toEqual([
      REMINDER_OFFSETS.TEN_MINUTES,
    ]);
  });

  it("ignores an unsupported offset rather than snapping it", () => {
    // "3 days before" has no matching option, so no reminder is invented.
    expect(resolveReminders("remind me 3 days before").offsets).toEqual([]);
  });

  it("returns no reminder when none is requested", () => {
    expect(resolveReminders("buy groceries").offsets).toEqual([]);
  });
});

describe("matchExistingTags", () => {
  it("matches an existing tag mentioned in the text", () => {
    expect(matchExistingTags("finish the assignment", ["assignment", "work"])).toEqual([
      "assignment",
    ]);
  });

  it("never invents a tag that does not exist", () => {
    expect(matchExistingTags("buy groceries", ["work", "urgent"])).toEqual([]);
  });

  it("ignores very short tags that would match anything", () => {
    expect(matchExistingTags("a b c", ["a"])).toEqual([]);
  });
});
describe("parseTaskDraft", () => {
  it("parses 'tomorrow at 6 PM'", () => {
    const { draft } = parse("Tomorrow at 6 PM remind me to call Rahul about the project");
    expect(draft.taskDate).toBe("2026-09-27");
    expect(draft.startTime).toBe("18:00");
    expect(draft.endTime).toBe("19:00");
    expect(draft.title).toBe("call Rahul about the project");
    expect(draft.timezone).toBe("Asia/Kolkata");
  });

  it("parses 'today at 9 AM'", () => {
    const { draft } = parse("today at 9 AM");
    expect(draft.taskDate).toBe("2026-09-26");
    expect(draft.startTime).toBe("09:00");
  });

  it("parses 'next Monday' without inventing a time", () => {
    const { draft, unresolved } = parse("Call my manager next Monday");
    expect(draft.taskDate).toBe("2026-09-28");
    expect(draft.startTime).toBeUndefined();
    expect(unresolved).toContain("startTime");
  });

  it("parses 'every day'", () => {
    expect(parse("Water plants every day").draft.recurrence).toBe("DAILY");
  });

  it("parses 'every Monday' without inventing a repeat", () => {
    const { draft, notes } = parse("Team sync every Monday");
    expect(draft.recurrence).toBeNull();
    expect(notes.join(" ")).toMatch(/not supported yet/i);
  });

  it("detects urgent priority", () => {
    expect(parse("Fix the urgent production issue").draft.priority).toBe("URGENT");
  });

  it("detects high priority", () => {
    expect(parse("High priority: submit tax return").draft.priority).toBe("HIGH");
  });

  it("carries an explicit reminder through", () => {
    const { draft } = parse("Pay rent tomorrow, remind me one hour before");
    expect(draft.reminderOffsets).toEqual([REMINDER_OFFSETS.ONE_HOUR]);
  });

  it("leaves an ambiguous date unset and reports it", () => {
    const { draft, unresolved } = parse("Call Rahul about the project");
    expect(draft.taskDate).toBeUndefined();
    expect(draft.startTime).toBeUndefined();
    expect(unresolved).toEqual(expect.arrayContaining(["taskDate", "startTime"]));
  });

  it("keeps the whole phrase as the title when nothing is recognised", () => {
    expect(parse("Buy groceries").draft.title).toBe("Buy groceries");
  });

  it("preserves the user's timezone rather than the browser's", () => {
    expect(parse("Standup tomorrow at 9").draft.timezone).toBe("Asia/Kolkata");
  });

  it("suggests only tags the user already has", () => {
    expect(parse("Finish the assignment tomorrow", ["assignment"]).draft.suggestedTagNames).toEqual([
      "assignment",
    ]);
    expect(parse("Finish the assignment tomorrow", []).draft.suggestedTagNames).toEqual([]);
  });

  it("never produces an empty title", () => {
    expect(parse("tomorrow").draft.title.length).toBeGreaterThan(0);
    expect(parse("at 6 PM").draft.title.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same input yields the same draft", () => {
    const input = "Finish the report tomorrow at 3 PM urgent";
    expect(parse(input).draft).toEqual(parse(input).draft);
  });

  it("handles empty and whitespace input without throwing", () => {
    expect(parse("").draft.title).toBe("");
    expect(parse("   ").draft.title).toBe("");
  });

  it("does not treat an explicit priority as a reason to override user choice later", () => {
    // The parser only ever *suggests*; the review screen owns the final value.
    const { draft } = parse("Buy groceries");
    expect(draft.priority).toBe("MEDIUM");
  });
});

