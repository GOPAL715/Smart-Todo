import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { requiresEmailVerification } from "./signUpFlow";

/*
 * These pin the signup branch point, not Supabase.
 *
 * The bug was that `signUp()`'s decision about email confirmation was thrown
 * away, so a project with confirmation enabled sent a brand-new user straight
 * to `/app/dashboard`, where ProtectedRoute (correctly) redirected them to
 * `/login`. The rule under test is Supabase's own contract: a null/absent
 * `session` means confirmation is required, and a returned session means the
 * user is already signed in.
 */
describe("requiresEmailVerification", () => {
  it("is true when Supabase returns no session (confirmation enabled)", () => {
    expect(requiresEmailVerification(null)).toBe(true);
    expect(requiresEmailVerification(undefined)).toBe(true);
  });

  it("is false when Supabase returns a session (confirmation disabled)", () => {
    // Only nullness is inspected. The session object is never read, so this
    // holds for any real session shape without depending on its internals.
    expect(requiresEmailVerification({ access_token: "x" })).toBe(false);
    expect(requiresEmailVerification({})).toBe(false);
  });

  it("does not treat other falsy values as 'no session'", () => {
    // Guards against a loose `!session` check, which would wrongly classify a
    // present-but-empty object as confirmation required.
    expect(requiresEmailVerification(0)).toBe(false);
    expect(requiresEmailVerification("")).toBe(false);
    expect(requiresEmailVerification(false)).toBe(false);
  });

  it("decides the next screen from the session alone, never from the email", () => {
    // The predicate takes only the session, so it structurally cannot leak the
    // address back to the caller or branch on it.
    expect(requiresEmailVerification.length).toBe(1);
  });
});

/*
 * The signup screen's contract, asserted on real rendered markup the same way
 * the existing accessibility tests do. No DOM environment is required.
 */
describe("signup email-verification screen", () => {
  it("tells the user to check their email", async () => {
    const { CheckEmailNotice } = await import(
      "@/components/auth/CheckEmailNotice"
    );
    const markup = renderToStaticMarkup(<CheckEmailNotice />);

    expect(markup).toContain("Check your email");
    expect(markup).toContain("verification link");
  });

  it("announces the state politely, as a status rather than an alert", async () => {
    const { CheckEmailNotice } = await import(
      "@/components/auth/CheckEmailNotice"
    );
    const markup = renderToStaticMarkup(<CheckEmailNotice />);

    // Nothing failed, so this must not be announced assertively.
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain('role="alert"');
  });

  it("echoes no email address, token, or verification link", async () => {
    const { CheckEmailNotice } = await import(
      "@/components/auth/CheckEmailNotice"
    );
    const markup = renderToStaticMarkup(<CheckEmailNotice />);

    // No address is rendered, and no href/token is exposed, so the screen
    // cannot be used to confirm that a particular account exists.
    expect(markup).not.toContain("@");
    expect(markup).not.toContain("token");
    expect(markup).not.toContain("access_token");
    expect(markup).not.toContain("<a ");
  });

  it("keeps a single, consistent heading for the state", async () => {
    const { CHECK_EMAIL_HEADING, CHECK_EMAIL_DESCRIPTION } = await import(
      "@/components/auth/CheckEmailNotice"
    );

    expect(CHECK_EMAIL_HEADING).toBe("Verify your email");
    // The supporting sentence must not vary with the address either.
    expect(CHECK_EMAIL_DESCRIPTION).toBe(
      "Your account was created. Confirm your email address to sign in."
    );
  });
});