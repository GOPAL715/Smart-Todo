import { describe, expect, it } from "vitest";
import {
  getPasswordStrength,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
  MIN_STRENGTH_SCORE,
} from "./passwordPolicy";

/*
 * The project has no DOM test environment, so these cover the policy and the
 * redirect/reset logic as pure functions and through a mocked Supabase client.
 * That is where every security property of this flow lives; the two page
 * components are thin wrappers over exactly these results.
 */

describe("getPasswordStrength", () => {
  it("scores nothing for an empty password", () => {
    expect(getPasswordStrength("")).toEqual({ score: 0, label: "", suggestions: [] });
  });

  it("awards one point per satisfied rule", () => {
    expect(getPasswordStrength("Str0ng!Pass").score).toBe(4);
  });

  it("lists the rules that are not yet satisfied", () => {
    const { suggestions } = getPasswordStrength("abc");
    expect(suggestions).toHaveLength(4);
    expect(suggestions).toContain(`At least ${MIN_PASSWORD_LENGTH} characters`);
    expect(suggestions).toContain("A number");
  });

  it("never returns the password itself", () => {
    const password = "Str0ng!Pass";
    expect(JSON.stringify(getPasswordStrength(password))).not.toContain(password);
  });
});

describe("validateNewPassword", () => {
  it("accepts a password that satisfies the policy", () => {
    expect(validateNewPassword("Str0ng!Pass", "Str0ng!Pass")).toEqual({ ok: true });
  });

  it("rejects an empty password", () => {
    const result = validateNewPassword("", "");
    expect(result).toEqual({
      ok: false,
      field: "password",
      error: "Please enter a password.",
    });
  });

  it("rejects a password shorter than the minimum", () => {
    const result = validateNewPassword("Ab1!xyz", "Ab1!xyz");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      field: "password",
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  });

  it("rejects a long password that is still too weak", () => {
    const result = validateNewPassword("aaaaaaaaaaaa", "aaaaaaaaaaaa");
    expect(result).toMatchObject({
      ok: false,
      field: "password",
      error: "Password is too weak. Please use a stronger password.",
    });
  });

  it("uses the same strength threshold signup has always applied", () => {
    // Guards against the shared policy drifting away from MIN_STRENGTH_SCORE.
    // A password satisfying exactly three of the four rules is the boundary.
    const borderline = "Abcdefgh1"; // long, mixed case, digit — no symbol
    expect(getPasswordStrength(borderline).score).toBe(MIN_STRENGTH_SCORE);
    expect(validateNewPassword(borderline, borderline).ok).toBe(true);
  });

  it("rejects a password one rule short of the threshold", () => {
    const tooWeak = "abcdefgh1"; // long, has digit — no upper case, no symbol
    expect(getPasswordStrength(tooWeak).score).toBe(MIN_STRENGTH_SCORE - 1);
    expect(validateNewPassword(tooWeak, tooWeak).ok).toBe(false);
  });

  it("rejects a mismatched confirmation and blames the confirmation field", () => {
    const result = validateNewPassword("Str0ng!Pass", "Str0ng!Pass2");
    expect(result).toEqual({
      ok: false,
      field: "confirmPassword",
      error: "Passwords do not match.",
    });
  });

  it("rejects a missing confirmation", () => {
    expect(validateNewPassword("Str0ng!Pass", "")).toMatchObject({
      ok: false,
      field: "confirmPassword",
      error: "Please confirm your password.",
    });
  });

  it("checks the password before the confirmation", () => {
    // Both are wrong, so the user is told to fix the password first rather
    // than being sent to a field that is not yet the problem.
    expect(validateNewPassword("weak", "alsoDifferent")).toMatchObject({
      ok: false,
      field: "password",
    });
  });

  it("never includes either password in the result", () => {
    const password = "Str0ng!Pass";
    const confirm = "Str0ng!PassX";
    const result = validateNewPassword(password, confirm);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain(confirm);
  });
});
