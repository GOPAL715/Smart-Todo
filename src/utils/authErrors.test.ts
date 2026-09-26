import { describe, expect, it } from "vitest";
import { getAuthErrorMessage } from "./authErrors";

describe("getAuthErrorMessage", () => {
  it("returns a string for a plain object with a message, without recursing", () => {
    // Regression: this used to call getAuthErrorMessage(err) with the same
    // value, re-entering the same branch until the stack overflowed.
    const error = { message: "example" };
    const result = getAuthErrorMessage(error);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not overflow the stack for a self-referential-shaped error", () => {
    const error: { message: string } = { message: "example" };
    // A second call proves the function terminates rather than recursing.
    expect(() => getAuthErrorMessage(error)).not.toThrow();
    expect(getAuthErrorMessage(error)).toBe(getAuthErrorMessage(error));
  });

  it("classifies a plain object by its code", () => {
    expect(getAuthErrorMessage({ message: "x", code: "invalid_email" })).toBe(
      "Please enter a valid email address."
    );
    expect(getAuthErrorMessage({ message: "x", code: "user_already_exists" })).toBe(
      "This email is already registered. Please use a different email or sign in."
    );
  });

  it("falls back to message inspection for a plain object with no code", () => {
    expect(getAuthErrorMessage({ message: "Failed to fetch" })).toBe(
      "Unable to connect. Please check your internet connection and try again."
    );
  });

  it("still handles Error instances the same way", () => {
    const err = new Error("Email logins are disabled") as Error & { code?: string };
    err.code = "user_not_found";
    expect(getAuthErrorMessage(err)).toBe("Invalid email or password.");
  });

  it("handles a real Error with no code", () => {
    expect(getAuthErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Unable to connect. Please check your internet connection and try again."
    );
  });

  it("handles a breached-password message", () => {
    expect(getAuthErrorMessage(new Error("Password has been leaked in a data breach"))).toBe(
      "This password has been found in a data breach. Please choose a different password."
    );
  });

  it("returns a safe generic message for null, undefined and primitives", () => {
    for (const value of [null, undefined, 42, "a string", true]) {
      expect(getAuthErrorMessage(value)).toBe("Something went wrong. Please try again.");
    }
  });

  it("never returns the raw provider message", () => {
    const secretish = "postgres://user:hunter2@db.internal:5432/main";
    const result = getAuthErrorMessage({ message: secretish });
    expect(result).not.toContain("hunter2");
    expect(result).toBe("Something went wrong. Please try again.");
  });
});
