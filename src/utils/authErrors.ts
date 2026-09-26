type SupabaseAuthError = {
  message: string;
  code?: string;
  status?: number;
};

function isSupabaseAuthError(err: unknown): err is SupabaseAuthError {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as SupabaseAuthError).message === "string"
  );
}

/**
 * Maps a Supabase-shaped auth error to fixed, user-safe copy.
 *
 * Kept separate from `getAuthErrorMessage` so both an `Error` instance and a
 * plain `{ message, code }` object resolve through exactly one code path. Only
 * the fixed strings below ever reach the user; raw provider text is used solely
 * for classification and is never returned, which preserves the app's
 * non-enumerable error philosophy.
 */
function resolveAuthErrorMessage(supabaseErr: SupabaseAuthError): string {
  const code = supabaseErr.code ?? "";
  const message = supabaseErr.message ?? "";

  switch (code) {
      case "weak_password":
      case "auth/weak-password":
        return "Password is too weak. Please use a stronger password.";

      case "user_already_exists":
      case "auth/user-already-exists":
      case "email_exists":
      case "auth/email-already-in-use":
        return "This email is already registered. Please use a different email or sign in.";

      case "invalid_email":
      case "auth/invalid-email":
        return "Please enter a valid email address.";

      case "user_not_found":
      case "auth/user-not-found":
        return "Invalid email or password.";

      case "wrong_password":
      case "auth/wrong-password":
        return "Invalid email or password.";

      case "user_disabled":
      case "auth/user-disabled":
        return "This account has been disabled. Please contact support.";

      case "email_not_confirmed":
      case "auth/email-not-confirmed":
      case "confirmation_code_expired":
      case "auth/confirmation-code-expired":
        return "Please verify your email before signing in.";

      case "too_many_requests":
      case "auth/too-many-requests":
      case "rate_limit_exceeded":
        return "Too many attempts. Please wait and try again.";

      case "operation_not_allowed":
      case "auth/operation-not-allowed":
        return "Sign-in is not enabled for this project. Please contact support.";

      case "expired_link":
      case "auth/expired-link":
      case "invalid_link":
      case "auth/invalid-link":
        return "This password reset link is invalid or has expired. Please request a new one.";

      case "network_request_failed":
      case "auth/network-request-failed":
        return "Unable to connect. Please check your internet connection and try again.";

      default:
        if (message.toLowerCase().includes("password") && message.toLowerCase().includes("breach")) {
          return "This password has been found in a data breach. Please choose a different password.";
        }

        if (message.toLowerCase().includes("already registered") || message.toLowerCase().includes("already exists")) {
          return "This email is already registered. Please use a different email or sign in.";
        }

        if (message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch") || message.toLowerCase().includes("failed to fetch")) {
          return "Unable to connect. Please check your internet connection and try again.";
        }

        return "Something went wrong. Please try again.";
    }
}

export function getAuthErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return resolveAuthErrorMessage(err as unknown as SupabaseAuthError);
  }

  if (isSupabaseAuthError(err)) {
    /*
     * A plain object that structurally matches a Supabase auth error (it has a
     * `message`, but is not an `Error` instance). Re-entering this function with
     * the same value would take this same branch again and recurse until the
     * stack overflows, so the provider shape is resolved here directly instead
     * of by a self-call.
     */
    return resolveAuthErrorMessage(err);
  }

  return "Something went wrong. Please try again.";
}

export function getNetworkErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed") || msg.includes("abort")) {
      return "Unable to connect. Please check your internet connection and try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
