import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeadersFor, isAllowedOrigin } from "./cors.ts";

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });
}

/**
 * Constant-time string comparison so no credential check leaks information
 * through response timing.
 */
function secureEquals(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  /*
   * Preflight. A browser always sends `Origin`, so an OPTIONS request without a
   * verified origin is rejected rather than answered with a permissive policy.
   * The non-browser scheduler only ever issues POST and is unaffected.
   */
  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeadersFor(origin) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("process-reminders: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return jsonResponse({ error: "Internal error" }, 500, origin);
    }

    // This routine processes reminders for EVERY user and bypasses row level
    // security, so it is an operator-only entry point. Two callers are trusted:
    //   1. A holder of the service role key (manual / administrative invocation),
    //      proven by presenting that key as the bearer token.
    //   2. The in-database scheduler, which presents a dedicated token held in
    //      Vault. That token is generated inside the database and never reaches
    //      the browser.
    // A signed-in end user must not be able to drive cross-tenant writes and an
    // anonymous caller must not reach it at all. Platform JWT verification stays
    // enabled, so every request must also carry a valid project JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const schedulerToken = (req.headers.get("X-Scheduler-Token") ?? "").trim();

    let authorized = false;

    if (bearerToken && secureEquals(bearerToken, serviceRoleKey)) {
      authorized = true;
    } else if (schedulerToken) {
      // The stored token is readable only with the service role key, so this
      // lookup is itself a privileged operation.
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: storedToken, error: tokenError } = await admin.rpc(
        "get_reminder_scheduler_token",
      );
      if (tokenError) {
        console.error("process-reminders: scheduler token lookup failed:", tokenError.message);
      } else if (typeof storedToken === "string" && storedToken.length > 0) {
        authorized = secureEquals(schedulerToken, storedToken);
      }
    }

    if (!authorized) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("process_all_due_reminders");

    if (error) {
      // Log the detail server-side; never return backend error text to a caller.
      console.error("process-reminders: rpc failed:", error.message);
      return jsonResponse({ error: "Internal error" }, 500, origin);
    }

    return jsonResponse(data, 200, origin);
  } catch (err) {
    console.error("process-reminders: unhandled error:", err);
    return jsonResponse({ error: "Internal error" }, 500, origin);
  }
});
