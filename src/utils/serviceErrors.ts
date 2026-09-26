/**
 * Postgres SQLSTATE codes that mean "this caller is not allowed to do that".
 *
 * 42501 insufficient_privilege — RLS policy denied the row
 * 42P01 undefined_table, 42703 undefined_column — the role cannot even see it
 *
 * The numeric equivalents are accepted because some PostgREST paths surface the
 * code as a string.
 */
const AUTHORIZATION_CODES = new Set([
  "42501", // insufficient_privilege
  "42P01", // undefined_table
  "42703", // undefined_column
  "28000", // invalid_authorization_specification
  "28P01", // invalid_password
]);

/** PostgREST / fetch-level failures that mean the request never reached Postgres. */
const NETWORK_CODES = new Set([
  "PGRST301", // connection pooler error
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
]);

/** A PostgREST error carries a machine-readable `code` alongside its message. */
type PostgrestError = { code?: string; message?: string; details?: string; hint?: string };

function readStructuredError(err: unknown): PostgrestError | null {
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as PostgrestError;
  return typeof candidate.code === "string" || typeof candidate.message === "string"
    ? candidate
    : null;
}

function isNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  // Matched as whole phrases so ordinary copy ("failed to save the row") is not
  // mistaken for a connectivity problem.
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("network request failed") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("load failed") ||
    lower.includes("err_internet_disconnected")
  );
}

/**
 * Turns a Supabase/PostgREST failure into fixed, user-safe copy.
 *
 * Classification is driven by the structured `code` first and only falls back to
 * narrow phrase matching on the message. It deliberately does NOT treat the
 * word "row" as a permissions signal: "row-level security" appears in genuine
 * RLS denials, but so does "a row named X failed", which previously produced a
 * false "You do not have permission" message and sent users chasing an
 * authorisation problem they do not have.
 *
 * Raw provider text is never returned, so this cannot leak table names, column
 * names, or SQL to the user.
 */
export function getServiceErrorMessage(err: unknown): string {
  const structured = readStructuredError(err);

  if (structured) {
    const code = structured.code?.toUpperCase();
    const message = structured.message ?? "";

    if (code && AUTHORIZATION_CODES.has(code)) {
      return "You do not have permission to perform this action.";
    }
    if (code && NETWORK_CODES.has(code)) {
      return "Unable to connect. Please check your internet connection and try again.";
    }
    if (isNetworkError(message)) {
      return "Unable to connect. Please check your internet connection and try again.";
    }
  }

  if (err instanceof Error) {
    // A plain Error carries no code, so fall back to the same narrow matcher.
    if (isNetworkError(err.message)) {
      return "Unable to connect. Please check your internet connection and try again.";
    }
  }

  return "Something went wrong. Please try again.";
}

export function throwServiceError(err: unknown): never {
  throw new Error(getServiceErrorMessage(err));
}
