/**
 * The signup flow's one branch point.
 *
 * Supabase decides whether a new account needs to confirm its email address,
 * and reports that decision in a single field of the `signUp()` response:
 *
 *   * Email confirmation ENABLED  -> `session` is `null`. No session is issued
 *     until the user clicks the emailed link. `user` is still returned.
 *   * Email confirmation DISABLED -> `session` is populated and the user is
 *     signed in immediately.
 *
 * The app previously ignored this field and always navigated to the dashboard.
 * With confirmation enabled there is no session at that point, so the protected
 * route bounced the brand-new user straight back to `/login` and the
 * check-your-email state was never shown.
 *
 * This is a pure predicate on Supabase's response shape, kept separate from the
 * hook so it can be unit tested without a browser environment. It carries no
 * account information of its own: it only reports which of Supabase's two
 * documented outcomes occurred, and never inspects or forwards the email
 * address, the user object, or any token.
 */
export function requiresEmailVerification(session: unknown): boolean {
  return session === null || session === undefined;
}

/**
 * What `signUp()` reports back to the caller.
 *
 * Deliberately carries no user, email, or token: the caller only needs to know
 * which screen to show next. Nothing here can be used to learn whether a given
 * address exists beyond what Supabase already returned to the browser.
 */
export interface SignUpResult {
  /** True when Supabase issued no session and the user must confirm by email. */
  requiresEmailVerification: boolean;
}