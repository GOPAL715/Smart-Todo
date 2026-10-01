import type { ReactNode } from "react";

/**
 * The unannounced-error problem this fixes.
 *
 * Every public authentication page rendered its failure message in a plain
 * `<div>`, so it was visible but silent: a screen-reader user heard nothing when
 * sign-in or password reset failed. `role="alert"` gives the node an implicit
 * `aria-live="assertive"` role, so assistive technology announces it as soon as
 * the node appears.
 *
 * Announced on mount, never on keystroke: the banner only exists while there is
 * an error, and its contents are set once per attempt rather than per character.
 * A page therefore announces at most once per failed submission, with no repeat
 * announcements while the user is still typing.
 *
 * The text is passed through untouched so callers keep their existing wording —
 * including the generic copy `getAuthErrorMessage` / `NEUTRAL_RESET_MESSAGE`
 * produce, which deliberately never reveals whether an address is registered.
 */
export function AuthErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in"
    >
      {children}
    </div>
  );
}