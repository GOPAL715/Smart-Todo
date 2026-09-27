import { getServiceErrorMessage, classifyServiceFailure } from "@/utils/serviceErrors";
import { getAuthErrorMessage } from "@/utils/authErrors";

/**
 * A small, stable classification for user-facing failures.
 *
 * This layer labels errors; it does not write them. `getAuthErrorMessage` and
 * `getServiceErrorMessage` remain the single source of every sentence a user
 * reads, so the specialised copy that protects password reset and account
 * enumeration is preserved untouched. `appError` only decides *what kind* of
 * failure this is and whether retrying is sensible.
 *
 * `retryable` is metadata for the UI. It never triggers a request on its own —
 * nothing here retries, and an operation only becomes retryable in the interface
 * if it already had a way to be run again.
 */
export type AppErrorCategory =
  | "auth"
  | "validation"
  | "permission"
  | "not_found"
  | "conflict"
  | "network"
  | "server"
  | "unknown";

export interface AppError {
  message: string;
  category: AppErrorCategory;
  retryable: boolean;
}

/**
 * The fixed sentences the existing mappers already emit for transient
 * conditions.
 *
 * Retryability is derived from this app's *own* copy rather than from a second
 * list of provider error codes, which keeps the provider-code knowledge in
 * exactly one place. If someone rewords a mapper, the pinning test in
 * `appError.test.ts` fails rather than silently changing retry semantics.
 */
const TRANSIENT_COPY = new Set([
  "Unable to connect. Please check your internet connection and try again.",
  "Too many attempts. Please wait and try again.",
]);

/**
 * PostgREST integrity codes that mean the request was well-formed but the data
 * was not acceptable. These are classifications rather than copies: neither
 * mapper above handles them today, so there is nothing to duplicate.
 */
const CONFLICT_CODES = new Set(["23505", "23503"]); // unique_violation, foreign_key_violation
const VALIDATION_CODES = new Set(["23502", "23514", "22P02", "22007"]); // not_null, check_violation, invalid_text_representation, invalid_datetime_format
const NOT_FOUND_CODES = new Set(["PGRST116"]); // no row returned where exactly one was required

/** Shapes carrying provider detail we can classify. Never logged or displayed raw. */
interface ProviderError {
  code?: string;
  message?: string;
  status?: number;
  details?: unknown;
  hint?: unknown;
}

function asProviderError(err: unknown): ProviderError | null {
  if (typeof err !== "object" || err === null) return null;
  return err as ProviderError;
}

/**
 * Supabase Auth failures and PostgREST failures are both `{ code, message }`, but
 * only the auth client sets `status`, and only PostgREST sets `details`/`hint`.
 * That structural difference is the whole discriminator — no code list to keep
 * in sync with `authErrors`.
 */
function isAuthShaped(err: ProviderError): boolean {
  return typeof err.status === "number" && err.details === undefined && err.hint === undefined;
}

function isPostgrestShaped(err: ProviderError): boolean {
  return err.details !== undefined || err.hint !== undefined;
}

const SERVER_STATUSES = new Set([500, 502, 503, 504]);

/**
 * Classifies a failure and returns the safe message to show.
 *
 * An already-normalized `Error` — the shape every throwing service produces
 * via `new Error(getServiceErrorMessage(err))` — deliberately carries no
 * recoverable provider detail. Its original classification is gone by then, so
 * it is reported as `unknown` rather than guessed at, and the message is
 * re-derived through the service mapper rather than trusted, because a bare
 * `Error` is not necessarily a mapper-produced one.
 *
 * That means a thrown "You do not have permission…" does not survive as-is. The
 * compensating behaviour lives in `getActionErrorMessage`, which supplies the
 * screen's own operation-specific copy instead — so the user still reads what
 * they read before, rather than a generic downgrade.
 */
export function normalizeAppError(error: unknown): AppError {
  const provider = asProviderError(error);

  if (provider && isAuthShaped(provider)) {
    return finalize("auth", getAuthErrorMessage(error));
  }

  if (provider && isPostgrestShaped(provider)) {
    const code = provider.code?.toUpperCase();

    if (code && CONFLICT_CODES.has(code)) {
      return finalize("conflict", getServiceErrorMessage(error));
    }
    if (code && VALIDATION_CODES.has(code)) {
      return finalize("validation", getServiceErrorMessage(error));
    }
    if (code && NOT_FOUND_CODES.has(code)) {
      return finalize("not_found", getServiceErrorMessage(error));
    }

    const service = classifyServiceFailure(error);
    if (service === "permission") {
      return finalize("permission", getServiceErrorMessage(error));
    }
    if (service === "network") {
      return finalize("network", getServiceErrorMessage(error));
    }

    // Only a real 5xx is called a server failure. A PostgREST error with no
    // status, or a 4xx whose code means nothing to the UI, is reported as
    // unknown rather than optimistically labelled retryable.
    if (provider.status !== undefined && SERVER_STATUSES.has(provider.status)) {
      return finalize("server", getServiceErrorMessage(error));
    }

    return finalize("unknown", getServiceErrorMessage(error));
  }

  // A plain Error, or something that is not an error at all. The service mapper
  // still recognises a connectivity failure carried as a message, so a network
  // blip is not mislabelled.
  const service = classifyServiceFailure(error);
  if (service === "network") {
    return finalize("network", getServiceErrorMessage(error));
  }
  if (service === "permission") {
    return finalize("permission", getServiceErrorMessage(error));
  }

  return finalize("unknown", getServiceErrorMessage(error));
}

/**
 * Applies the retryability rule.
 *
 * Connectivity and genuine 5xx failures are worth trying again; everything else
 * needs the user to change something first, so it is not. The transient-copy
 * check is what makes an auth rate limit retryable, since that failure is
 * classified as `auth` and its sentence is the only signal available.
 */
function finalize(category: AppErrorCategory, message: string): AppError {
  const retryable =
    category === "network" || category === "server" || TRANSIENT_COPY.has(message);
  return { message, category, retryable };
}

/**
 * The message to show after a specific user action failed.
 *
 * Keeps the operation's own framing — "Could not start task. Please try again."
 * says what failed, which a generic sentence does not — but lets a connectivity
 * failure speak for itself, because "check your internet connection" is more
 * actionable than being told to try the same failing thing again.
 *
 * `fallback` is the operation-specific copy the screen already used.
 */
export function getActionErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizeAppError(error);
  return normalized.retryable ? normalized.message : fallback;
}
