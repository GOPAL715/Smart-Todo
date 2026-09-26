import { describe, expect, it } from "vitest";
import { getServiceErrorMessage, throwServiceError } from "./serviceErrors";

const PERMISSION = "You do not have permission to perform this action.";
const NETWORK = "Unable to connect. Please check your internet connection and try again.";
const GENERIC = "Something went wrong. Please try again.";

describe("getServiceErrorMessage", () => {
  it("recognises a real RLS / authorization denial by its code", () => {
    expect(getServiceErrorMessage({ code: "42501", message: "new row violates row-level security policy" })).toBe(PERMISSION);
    expect(getServiceErrorMessage({ code: "42P01", message: "relation does not exist" })).toBe(PERMISSION);
  });

  it("recognises an authorization denial surfaced as an Error", () => {
    const err = new Error("permission denied for table tasks");
    expect(getServiceErrorMessage(err)).toBe(GENERIC);
  });

  it("does NOT treat an ordinary message containing 'row' as a permission error", () => {
    // Regression: the old substring check made "a row named something failed"
    // report a permissions problem the user does not have.
    expect(getServiceErrorMessage(new Error("A row named something failed"))).toBe(GENERIC);
    expect(getServiceErrorMessage(new Error("row"))).toBe(GENERIC);
    expect(getServiceErrorMessage({ message: "A row named something failed" })).toBe(GENERIC);
    expect(getServiceErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(GENERIC);
  });

  it("recognises network failures", () => {
    expect(getServiceErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK);
    expect(getServiceErrorMessage(new Error("NetworkError when attempting to fetch resource"))).toBe(NETWORK);
    expect(getServiceErrorMessage({ code: "ECONNREFUSED", message: "connection refused" })).toBe(NETWORK);
  });

  it("does not classify ordinary copy containing 'failed' as a network problem", () => {
    // The old check matched any message containing "failed".
    expect(getServiceErrorMessage(new Error("Failed to save your changes"))).toBe(GENERIC);
    expect(getServiceErrorMessage(new Error("Save failed"))).toBe(GENERIC);
  });

  it("returns a generic message for unknown database errors", () => {
    expect(getServiceErrorMessage({ code: "23505", message: "unique violation" })).toBe(GENERIC);
    expect(getServiceErrorMessage(new Error("something odd"))).toBe(GENERIC);
  });

  it("handles null, undefined and primitives safely", () => {
    for (const value of [null, undefined, 7, true]) {
      expect(getServiceErrorMessage(value)).toBe(GENERIC);
    }
  });

  it("never leaks raw provider text to the user", () => {
    const leak = "duplicate key value violates unique constraint \"task_reminders_pkey\"";
    const result = getServiceErrorMessage({ code: "23505", message: leak });
    expect(result).not.toContain("task_reminders_pkey");
    expect(result).toBe(GENERIC);
  });
});

describe("throwServiceError", () => {
  it("throws an Error carrying the user-safe message", () => {
    expect(() => throwServiceError({ code: "42501", message: "rls" })).toThrow(PERMISSION);
    expect(() => throwServiceError(new Error("row stuff"))).toThrow(GENERIC);
  });
});
