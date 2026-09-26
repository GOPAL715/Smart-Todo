import { describe, it, expect } from "vitest";
import { isValidTimeInput, timeToMinutes, validateTimeRange } from "./timeInput";

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
