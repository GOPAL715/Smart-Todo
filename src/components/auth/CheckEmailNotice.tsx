/**
 * The post-signup "check your email" state.
 *
 * Shown when Supabase accepted the signup but issued no session because the
 * project requires email confirmation. The user is not signed in yet, so this
 * must not look or behave like a logged-in screen, and it must not pretend the
 * account can be used immediately.
 *
 * Privacy: the copy is deliberately identical for every address and never
 * echoes the address that was typed, so this screen cannot be used to learn
 * whether an account exists. It also states nothing about *why* an address is
 * involved beyond confirmation, and never renders a token, link, or user object.
 *
 * `role="status"` announces the change politely when the panel replaces the
 * form, so a screen-reader user learns the signup succeeded without the message
 * arriving silently. It is a status rather than an alert because nothing has
 * failed.
 *
 * The action is rendered by the page (its own `Link` to Sign In) rather than
 * passed in here, so this component stays free of react-router and testable
 * with no router context at all.
 */
export function CheckEmailNotice() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="check-email-notice"
      className="rounded-lg bg-primary-50 dark:bg-primary-950 border border-primary-200 dark:border-primary-800 px-4 py-3 text-sm text-primary-800 dark:text-primary-200 mb-4"
    >
      <p className="font-semibold">Check your email</p>
      <p className="mt-1">
        We sent a verification link to the email address you registered with.
        Open it to confirm your address and finish setting up your account.
      </p>
    </div>
  );
}

/** The heading shown above the panel, so the page keeps one h1. */
export const CHECK_EMAIL_HEADING = "Verify your email";

/** Neutral explanation under the heading. Echoes no account information. */
export const CHECK_EMAIL_DESCRIPTION =
  "Your account was created. Confirm your email address to sign in.";