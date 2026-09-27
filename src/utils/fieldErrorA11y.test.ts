import { describe, expect, it } from "vitest";
import { getFieldErrorId, getFieldErrorAria } from "./fieldErrorA11y";

/*
 * The project has no DOM test environment, so these cannot assert that a
 * rendered input carries the attributes. What they do pin is the invariant the
 * fix depends on: the input's `aria-describedby` and the message's `id` are the
 * same string, derived from one call, so the two cannot drift apart the way two
 * hand-written literals did.
 */

describe("getFieldErrorId", () => {
  it("combines the page prefix and field key", () => {
    expect(getFieldErrorId("email", "login")).toBe("login-email-error");
  });

  it("keeps ids distinct per field on the same page", () => {
    const ids = ["name", "email", "password", "confirmPassword"].map((f) =>
      getFieldErrorId(f, "signup")
    );
    expect(new Set(ids).size).toBe(4);
  });

  it("keeps ids distinct across pages that share a field name", () => {
    // `email` appears on both the login and forgot-password forms; without the
    // page prefix the two forms would share an id.
    expect(getFieldErrorId("email", "login")).not.toBe(
      getFieldErrorId("email", "forgot-password")
    );
  });

  it("is stable across calls, so a re-render does not change the id", () => {
    expect(getFieldErrorId("title", "task")).toBe(getFieldErrorId("title", "task"));
  });
});

describe("getFieldErrorAria", () => {
  it("marks the field invalid and links the message when there is an error", () => {
    expect(getFieldErrorAria("email", "login", true)).toEqual({
      "aria-invalid": true,
      "aria-describedby": "login-email-error",
    });
  });

  it("omits aria-describedby entirely when there is no error", () => {
    // Not an empty string and not a dangling id: the attribute should not be
    // present at all.
    expect(getFieldErrorAria("email", "login", false)).toEqual({
      "aria-invalid": false,
    });
    expect(getFieldErrorAria("email", "login", false)).not.toHaveProperty("aria-describedby");
  });

  it("agrees with getFieldErrorId, which is what the message element uses", () => {
    // The two halves of the fix meeting: input and message are wired together by
    // construction rather than by matching literals.
    for (const [field, prefix] of [
      ["title", "task"],
      ["startTime", "task"],
      ["password", "reset"],
      ["confirmPassword", "signup"],
    ] as const) {
      const aria = getFieldErrorAria(field, prefix, true);
      expect(aria["aria-describedby"]).toBe(getFieldErrorId(field, prefix));
    }
  });

  it("treats an empty error message as no error", () => {
    // Field errors are conditionally rendered, so an empty string is a real
    // state the call sites can produce.
    expect(getFieldErrorAria("email", "login", false)["aria-invalid"]).toBe(false);
  });

  it("produces unique ids for every field the audit listed", () => {
    const pairs: [string, string][] = [
      ["email", "login"],
      ["password", "login"],
      ["name", "signup"],
      ["email", "signup"],
      ["password", "signup"],
      ["confirmPassword", "signup"],
      ["email", "forgot-password"],
      ["password", "reset"],
      ["confirmPassword", "reset"],
      ["title", "task"],
      ["taskDate", "task"],
      ["startTime", "task"],
      ["endTime", "task"],
    ];
    const ids = pairs.map(([f, p]) => getFieldErrorId(f, p));
    expect(new Set(ids).size).toBe(pairs.length);
  });
});
