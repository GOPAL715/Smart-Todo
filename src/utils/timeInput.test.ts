import { describe, it, expect } from "vitest";
import {
  isValidTimeInput,
  timeToMinutes,
  validateTimeRange,
  addMinutesToTime,
  reconcileEndTime,
  DEFAULT_DURATION_MINUTES,
} from "./timeInput";

describe("isValidTimeInput", () => {
  it("accepts the format produced by <input type=\"time\">", () => {
    expect(isValidTimeInput("00:00")).toBe(true);
    expect(isValidTimeInput("09:30")).toBe(true);
    expect(isValidTimeInput("23:59")).toBe(true);
  });

  it("rejects out-of-range hours and minutes", () => {
    expect(isValidTimeInput("24:00")).toBe(false);
    expect(isValidTimeInput("12:60")).toBe(false);
    expect(isValidTimeInput("-1:00")).toBe(false);
    expect(isValidTimeInput("12:99")).toBe(false);
  });

  it("rejects malformed values the backend could never store", () => {
    expect(isValidTimeInput("")).toBe(false);
    expect(isValidTimeInput("abc")).toBe(false);
    expect(isValidTimeInput("9")).toBe(false);
    expect(isValidTimeInput("09:30:00")).toBe(false);
    expect(isValidTimeInput("09-30")).toBe(false);
    expect(isValidTimeInput(" 09:30")).toBe(false);
    expect(isValidTimeInput("09:30 ")).toBe(false);
  });
});

describe("timeToMinutes", () => {
  it("converts valid times to minutes past midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("returns null for malformed times instead of NaN", () => {
    expect(timeToMinutes("99:99")).toBeNull();
    expect(timeToMinutes("")).toBeNull();
  });
});

describe("validateTimeRange", () => {
  it("accepts a normal same-day range", () => {
    expect(validateTimeRange("09:00", "10:30")).toEqual({ valid: true });
  });

  it("accepts a range spanning midnight by clock (23:00 -> 23:59)", () => {
    expect(validateTimeRange("23:00", "23:59")).toEqual({ valid: true });
  });

  it("rejects identical start and end", () => {
    const result = validateTimeRange("09:00", "09:00");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.field).toBe("endTime");
      expect(result.message).toBe("Start and end time must be different");
    }
  });

  it("rejects a cross-midnight range with an explanatory message", () => {
    const result = validateTimeRange("23:00", "01:00");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.field).toBe("endTime");
      expect(result.message).toMatch(/not supported yet/);
    }
  });

  it("rejects a malformed start time before comparing ordering", () => {
    const result = validateTimeRange("nope", "10:00");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.field).toBe("startTime");
  });

  it("rejects a malformed end time", () => {
    const result = validateTimeRange("09:00", "25:00");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.field).toBe("endTime");
  });
});

/*
 * Regression for the production P2-1 defect: the task form opened with
 * independent 16:00 / 17:00 defaults, so raising the start past the default end
 * left a stale end behind and submitting failed with a cross-midnight message
 * the user never asked for.
 *
 * These tests pin the behaviour the form depends on, and are written against
 * `validateTimeRange` so the user-facing outcome ("this form can now be
 * submitted") is asserted, not just the helper's return value.
 */
describe("addMinutesToTime", () => {
  it("adds minutes and stays within the day", () => {
    expect(addMinutesToTime("16:00", 60)).toBe("17:00");
    expect(addMinutesToTime("18:30", 60)).toBe("19:30");
    expect(addMinutesToTime("23:30", 60)).toBe("23:59");
  });

  it("clamps rather than wrapping into the next day", () => {
    // Cross-midnight is unsupported, so an overflow must not roll over to 00:xx.
    expect(addMinutesToTime("23:59", 60)).toBe("23:59");
  });

  it("leaves a malformed time untouched instead of producing NaN", () => {
    expect(addMinutesToTime("nope", 60)).toBe("nope");
  });
});

describe("DEFAULT_DURATION_MINUTES", () => {
  it("keeps the duration the form and the parser already used", () => {
    // 16:00 -> 17:00 was the form default before this fix; the natural-language
    // parser defaulted a lone time to the same length.
    expect(DEFAULT_DURATION_MINUTES).toBe(60);
  });
});

describe("reconcileEndTime", () => {
  it("leaves the form's default pair untouched", () => {
    expect(reconcileEndTime("16:00", "17:00")).toBe("17:00");
  });

  it("repairs the stale default when the start moves past it (the P2-1 repro)", () => {
    expect(reconcileEndTime("18:30", "17:00")).toBe("19:30");
  });

  it("always produces an end strictly after the start", () => {
    for (const start of ["17:00", "17:01", "18:30", "20:00", "22:59", "23:00", "23:30"]) {
      const end = reconcileEndTime(start, "17:00");
      expect(timeToMinutes(end)).toBeGreaterThan(timeToMinutes(start) as number);
      expect(validateTimeRange(start, end)).toEqual({ valid: true });
    }
  });

  it("makes the previously unsaveable form saveable", () => {
    // Before the fix this exact pair was rejected with the cross-midnight message.
    expect(validateTimeRange("18:30", "17:00").valid).toBe(false);
    expect(validateTimeRange("18:30", reconcileEndTime("18:30", "17:00"))).toEqual({
      valid: true,
    });
  });

  it("preserves a valid end the user chose, however long", () => {
    expect(reconcileEndTime("18:30", "20:00")).toBe("20:00");
    expect(reconcileEndTime("16:00", "23:30")).toBe("23:30");
    expect(reconcileEndTime("09:00", "09:01")).toBe("09:01");
  });

  it("repairs an end that equals the start", () => {
    expect(reconcileEndTime("10:00", "10:00")).toBe("11:00");
  });

  it("does not invent cross-midnight support for a start with no valid same-day end", () => {
    // 23:59 + 60min clamps back to 23:59, which is still not after the start.
    // The pair is left for validation to reject rather than silently accepted.
    expect(reconcileEndTime("23:59", "23:59")).toBe("23:59");
    expect(validateTimeRange("23:59", reconcileEndTime("23:59", "23:59")).valid).toBe(false);
  });

  it("never leaves a cross-midnight pair in place after a start change", () => {
    // A start change may only ever move an invalid end to a valid same-day end.
    // It must not produce an end that wraps into the next day.
    expect(reconcileEndTime("23:00", "01:00")).toBe("23:59");
    expect(validateTimeRange("23:00", reconcileEndTime("23:00", "01:00"))).toEqual({
      valid: true,
    });
  });

  it("still rejects a cross-midnight pair the user entered directly", () => {
    // Nothing about the helper changes validateTimeRange: an end the user typed
    // that crosses midnight is still refused at submit time.
    const result = validateTimeRange("23:00", "01:00");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/not supported yet/);
  });

  it("leaves a malformed end alone so validation can report it", () => {
    expect(reconcileEndTime("10:00", "")).toBe("");
    expect(reconcileEndTime("10:00", "25:00")).toBe("25:00");
    expect(reconcileEndTime("10:00", "abc")).toBe("abc");
  });

  it("leaves a malformed start alone so validation can report it", () => {
    expect(reconcileEndTime("", "10:00")).toBe("10:00");
    expect(reconcileEndTime("nope", "10:00")).toBe("10:00");
  });

  it("never rewrites a valid end when the start moves backwards", () => {
    expect(reconcileEndTime("10:00", "18:00")).toBe("18:00");
  });
});
