import { describe, expect, it } from "vitest";
import { validateLoginForm } from "./loginValidation";
import { getFieldErrorAria, getFieldErrorId } from "./fieldErrorA11y";

/*
 * Regression for P3-3.
 *
 * Phase 23-M did not observe `aria-invalid` on the login fields. The reason is
 * that the inputs carry `required` (and `type="email"`), so the browser's own
 * constraint validation intercepted the submit before `handleSubmit` ran. The
 * application-level errors and their ARIA wiring are correct — verified live in
 * production with `novalidate` forced on, where the invalid field was marked
 * `aria-invalid="true"` with `aria-describedby="login-email-error"`.
 *
 * These tests pin that validation path directly so it cannot silently change,
 * and assert the ARIA contract each message produces. `validateLoginForm` holds
 * the rules that previously lived inline in `LoginPage.handleSubmit`.
 */
describe("validateLoginForm", () => {
  it("requires an email address", () => {
    expect(validateLoginForm("", "anything")).toEqual({
      email: "Please enter your email address.",
    });
    expect(validateLoginForm("   ", "anything")).toEqual({
      email: "Please enter your email address.",
    });
  });

  it("rejects a malformed email address", () => {
    expect(validateLoginForm("not-an-email", "x")).toEqual({
      email: "Please enter a valid email address.",
    });
    for (const bad of ["user", "user@", "user@host", "a b@host.com"]) {
      expect(validateLoginForm(bad, "x").email).toMatch(/valid email/);
    }
  });

  it("requires a password once the email is valid", () => {
    expect(validateLoginForm("a@b.co", "")).toEqual({
      password: "Please enter your password.",
    });
  });

  it("accepts a complete, well-formed credential pair", () => {
    expect(validateLoginForm("a@b.co", "secret")).toEqual({});
  });

  it("reports one error at a time rather than merging them", () => {
    // The original inline rules returned early, so the object was replaced and
    // never held two messages. Preserving that avoids a form announcing both
    // fields when only one needs fixing.
    expect(Object.keys(validateLoginForm("", "")).length).toBe(1);
    expect(validateLoginForm("", "")).toEqual({
      email: "Please enter your email address.",
    });
  });
});

describe("login field errors expose the correct ARIA", () => {
  it("maps the email error to a unique, correctly-named id", () => {
    const aria = getFieldErrorAria("email", "login", true);
    expect(aria["aria-invalid"]).toBe(true);
    expect(aria["aria-describedby"]).toBe(getFieldErrorId("email", "login"));
    expect(aria["aria-describedby"]).toBe("login-email-error");
  });

  it("maps the password error to a unique, correctly-named id", () => {
    const aria = getFieldErrorAria("password", "login", true);
    expect(aria["aria-invalid"]).toBe(true);
    expect(aria["aria-describedby"]).toBe("login-password-error");
  });

  it("does not mark a valid field invalid, and drops the describedby entirely", () => {
    const aria = getFieldErrorAria("email", "login", false);
    expect(aria["aria-invalid"]).toBe(false);
    expect(aria).not.toHaveProperty("aria-describedby");
  });

  it("keeps the two field ids distinct so errors are never merged", () => {
    expect(getFieldErrorId("email", "login")).not.toBe(
      getFieldErrorId("password", "login")
    );
  });

  it("covers every message validateLoginForm can produce", () => {
    // Every message must be reachable through a named field, or one of them
    // would render without an id to point at.
    const messages = [
      validateLoginForm("", "x").email,
      validateLoginForm("bad", "x").email,
      validateLoginForm("a@b.co", "").password,
    ];
    for (const msg of messages) expect(typeof msg).toBe("string");
    expect(messages.every((m) => m && m.length > 0)).toBe(true);
  });
});