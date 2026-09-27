/**
 * The application's password policy, shared by signup and password reset.
 *
 * This was previously a private helper inside `SignupPage`, so a user who reset
 * a password would have had no way to discover what a valid password looks like.
 * Extracting it keeps one definition of "acceptable password" in the app: a user
 * can set a password that later fails at sign-in, which is the kind of defect
 * that is invisible until it strands a real account.
 *
 * The rules are deliberately the app's existing ones (length, mixed case, a
 * number, and a special character). Nothing here is stricter than what signup
 * already enforced, so no account is held to a policy it was not created under.
 * Supabase Auth remains the authority; this only avoids a pointless round trip
 * for a password the app already knows is too weak.
 *
 * No password value is ever returned, stored, or logged by this module — only
 * scores, labels, and fixed message strings.
 */

/** Shortest password the app accepts. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The strength meter awards one point each for length, mixed case, a digit, and
 * a symbol. Signup already required at least this many, so a password that
 * passed signup also passes here.
 */
export const MIN_STRENGTH_SCORE = 3;

export interface PasswordStrength {
  /** 0-4. */
  score: number;
  /** Human-readable summary. Empty when there is no password to rate. */
  label: string;
  /** Fixed hints for the rules that are not yet satisfied. */
  suggestions: string[];
}

const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "", suggestions: [] };

  let score = 0;
  const suggestions: string[] = [];

  if (password.length >= MIN_PASSWORD_LENGTH) score++;
  else suggestions.push(`At least ${MIN_PASSWORD_LENGTH} characters`);

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  else suggestions.push("Uppercase and lowercase letters");

  if (/\d/.test(password)) score++;
  else suggestions.push("A number");

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else suggestions.push("A special character");

  return { score, label: STRENGTH_LABELS[score] ?? "Very strong", suggestions };
}

/** Which field a validation failure belongs to. */
export type PasswordField = "password" | "confirmPassword";

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; field: PasswordField; error: string };

/**
 * Validates a new password and its confirmation.
 *
 * The two are checked in the same order and with the same wording as signup so
 * the user is not told a password is acceptable on one screen and rejected on
 * the other. The comparison is a plain equality check on two values the user
 * already typed; neither is included in the result, which carries only a fixed
 * message.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string
): PasswordValidationResult {
  if (!password) {
    return { ok: false, field: "password", error: "Please enter a password." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: "password",
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (getPasswordStrength(password).score < MIN_STRENGTH_SCORE) {
    return {
      ok: false,
      field: "password",
      error: "Password is too weak. Please use a stronger password.",
    };
  }

  if (!confirmPassword) {
    return {
      ok: false,
      field: "confirmPassword",
      error: "Please confirm your password.",
    };
  }

  if (password !== confirmPassword) {
    return { ok: false, field: "confirmPassword", error: "Passwords do not match." };
  }

  return { ok: true };
}