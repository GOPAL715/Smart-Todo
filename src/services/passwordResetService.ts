import { supabase } from "@/services/supabase";
import { getAuthErrorMessage } from "@/utils/authErrors";

/**
 * Requesting and completing a Supabase Auth password reset.
 *
 * Two properties drive the design of this module:
 *
 * 1. **No account enumeration.** The same confirmation is shown whether or not
 *    an address is registered. Supabase's `resetPasswordForEmail` already
 *    returns success for an unknown address, so the UI never learns anything
 *    from the result. Nothing here branches on "user exists", and the failure
 *    path is mapped through the app's shared error copy, which never says that
 *    an account is missing.
 *
 * 2. **No open redirect.** The recovery redirect is always the app's own origin
 *    plus one fixed route. It is never taken from a query string, a hash, or
 *    any other user-controllable value, and `buildResetRedirectUrl` reduces the
 *    origin to `scheme://host[:port]` so a crafted value cannot smuggle a path
 *    or a second host through it.
 *
 * Like `profileService`, these return a structured result instead of throwing,
 * and neither ever echoes the email, the password, or raw provider text back to
 * the caller.
 */

/** The single route a recovery link is allowed to return the user to. */
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Shown for every syntactically valid request, whether or not it matched an
 * account. Wording is deliberately neutral.
 */
export const NEUTRAL_RESET_MESSAGE =
  "If an account exists for this email, you'll receive a password reset link.";

/** The redirect could not be derived from a usable origin. */
const REDIRECT_UNAVAILABLE =
  "We couldn't start the password reset. Please reload the page and try again.";

/** Matches the email rule already used by the login and signup screens. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export type ResetRequestResult = { ok: true } | { ok: false; error: string };
export type UpdatePasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Builds the recovery redirect for the current deployment.
 *
 * The origin is read from `window.location.origin` in the browser and reduced to
 * its `scheme://host[:port]` form, so the result is always
 * `<this origin>/reset-password`. A path, query, or fragment supplied with the
 * origin is discarded rather than appended, which is what stops a crafted value
 * from redirecting a recovery link to another host.
 *
 * Returns `null` when no usable absolute origin is available (a non-browser
 * context, or a relative/garbage origin) so the caller can fail safely instead
 * of sending Supabase a partial or untrusted redirect.
 */
export function buildResetRedirectUrl(origin?: string): string | null {
  const raw =
    origin ??
    (typeof window !== "undefined" ? window.location?.origin : undefined);

  if (typeof raw !== "string" || raw.trim() === "") return null;

  let resolved: URL;
  try {
    resolved = new URL(raw.trim());
  } catch {
    return null;
  }

  if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return null;

  return `${resolved.origin}${RESET_PASSWORD_PATH}`;
}

/**
 * Asks Supabase to email a recovery link.
 *
 * The caller shows `NEUTRAL_RESET_MESSAGE` on success regardless of the
 * address. On failure the shared error copy is used, which turns a
 * "user not found" style provider error into the same generic login-failure
 * wording used everywhere else, so an error can never become a probe for which
 * addresses are registered.
 */
export async function requestPasswordReset(
  email: string,
  origin?: string
): Promise<ResetRequestResult> {
  const redirectTo = buildResetRedirectUrl(origin);
  if (!redirectTo) {
    return { ok: false, error: REDIRECT_UNAVAILABLE };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo }
  );

  if (error) {
    return { ok: false, error: getAuthErrorMessage(error) };
  }

  return { ok: true };
}

/**
 * Writes the new password for the current session.
 *
 * Supabase Auth is the authority on whether this may succeed: the call only
 * works because the recovery link established a session, and the client already
 * refuses to run without one. This function adds no client-side authorization
 * of its own and does not persist the value anywhere.
 */
export async function updatePassword(newPassword: string): Promise<UpdatePasswordResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    return { ok: false, error: getAuthErrorMessage(error) };
  }

  return { ok: true };
}