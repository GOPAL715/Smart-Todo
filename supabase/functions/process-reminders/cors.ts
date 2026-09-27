/**
 * CORS policy for the process-reminders edge function.
 *
 * Kept in its own module, free of any Deno or `npm:` import, so the policy can
 * be unit tested under Node/Vitest. `index.ts` imports from here and adds
 * nothing of its own to the CORS behaviour.
 *
 * This function is NOT part of the browser application. It is invoked only
 * server-side:
 *
 *   1. The in-database scheduler: pg_cron -> pg_net -> this endpoint, once a
 *      minute, presenting the Vault-held `X-Scheduler-Token`.
 *   2. An operator holding the service-role key, for a manual run.
 *
 * No frontend code calls it: the browser uses `supabase.rpc('process_due_reminders')`
 * for the signed-in user's own reminders, which is a different, RLS-scoped path.
 * The scheduler is a plain HTTPS `net.http_post` from Postgres, which is not a
 * browser and therefore sends no Origin at all.
 *
 * The previous `Access-Control-Allow-Origin: *` was therefore never needed by a
 * legitimate caller, while telling every website on the internet that it may read
 * cross-origin responses from this endpoint. On a route that bypasses RLS across
 * all tenants, that is an unnecessary blast radius.
 *
 * The allowlist below is intentionally EMPTY of browser origins. It exists as an
 * explicit, reviewable list rather than being deleted so that a future, genuinely
 * browser-facing caller has one obvious place to be added - with a real origin
 * rather than a wildcard. Matching is exact string equality against a fixed set,
 * never a prefix/substring/regex test, so a hostile origin such as
 * `https://smart-todo-murex.vercel.app.evil.example` cannot be matched.
 *
 * The production frontend origin is intentionally absent because no browser
 * caller exists. Adding one speculatively would grant a real website standing
 * access to an RLS-bypassing endpoint for no benefit.
 */
export const ALLOWED_ORIGINS: readonly string[] = [];

/** Only the methods this function actually accepts. */
export const ALLOWED_METHODS = "POST, OPTIONS";

/** Headers a caller may send. The scheduler uses Content-Type/Authorization/X-Scheduler-Token. */
export const ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Client-Info, Apikey, X-Scheduler-Token";

/** True only for an exact match against the fixed allowlist. */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Builds the response headers for a request.
 *
 * `Access-Control-Allow-Origin` is emitted ONLY for an allowlisted origin and
 * is always the literal, verified value - never the request's Origin echoed back
 * and never `*`. For every other caller (including the scheduler, which sends no
 * Origin) the `Access-Control-Allow-Origin` header is omitted entirely, which is
 * correct: CORS is a browser-only mechanism and a non-browser caller ignores
 * these headers.
 *
 * `Access-Control-Allow-Credentials` is deliberately NOT set. Nothing here uses
 * cookie-based credentials, and enabling it would be unnecessary and is
 * incompatible with a wildcard should one ever be reintroduced.
 */
export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };

  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
    headers.Vary = "Origin";
  }

  return headers;
}
