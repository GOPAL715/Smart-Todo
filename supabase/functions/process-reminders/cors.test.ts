import { describe, expect, it } from "vitest";
import { ALLOWED_METHODS, corsHeadersFor, isAllowedOrigin } from "./cors";

/*
 * Phase 14D - CORS origin policy for the process-reminders edge function.
 *
 * The policy lives in `cors.ts` specifically so it can be tested under
 * Node/Vitest: `index.ts` imports the Deno-only `npm:` specifier and calls
 * `Deno.serve` at module scope, neither of which resolves outside Deno.
 *
 * The behaviour under test is the allowlist decision, which is the entire
 * security surface of this change. The function is invoked only by pg_cron
 * (server-side, sends no Origin) or by an operator holding the service-role
 * key, so no browser origin should be accepted.
 */
describe("process-reminders CORS origin policy", () => {
  it("rejects the production frontend origin", () => {
    // The single most important property. The old code answered every origin in
    // the world; while the allowlist is empty nothing may be accepted. This is
    // asserted explicitly so adding a browser origin forces a conscious review.
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app")).toBe(false);
  });

  it("rejects a development localhost origin", () => {
    // Local dev is a browser origin, but the browser never calls this function.
    expect(isAllowedOrigin("http://localhost:5173")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(false);
  });

  it("rejects an arbitrary malicious origin", () => {
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
  });

  it("rejects an origin that merely resembles a legitimate one", () => {
    // Guards against substring/prefix/regex matching, which would let an
    // attacker-controlled domain embedding the real host be accepted.
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app.evil.example")).toBe(false);
    expect(isAllowedOrigin("https://evil.example/smart-todo-murex.vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app@evil.example")).toBe(false);
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app.evil.example/")).toBe(false);
  });

  it("rejects scheme, port and case variants of a legitimate origin", () => {
    // Matching is exact string equality, so none of these near-misses pass.
    expect(isAllowedOrigin("http://smart-todo-murex.vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app:443")).toBe(false);
    expect(isAllowedOrigin("https://SMART-TODO-MUREX.vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://smart-todo-murex.vercel.app/")).toBe(false);
  });

  it("rejects a missing or empty origin", () => {
    // The scheduler sends no Origin at all; that must never be treated as a match.
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });

  it("never emits a wildcard or reflected Allow-Origin header", () => {
    for (const origin of [null, "", "https://evil.example", "https://smart-todo-murex.vercel.app"]) {
      const headers = corsHeadersFor(origin);
      // The header is absent entirely for every currently-disallowed origin.
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers.Vary).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('"*"');
    }
  });

  it("does not advertise credentialed requests", () => {
    // Nothing in this function uses cookies, and Allow-Credentials would be
    // incompatible with a wildcard if one were ever reintroduced.
    expect(corsHeadersFor(null)["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(corsHeadersFor("https://evil.example")["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("keeps the methods and headers the scheduler actually needs", () => {
    const headers = corsHeadersFor(null);
    // The scheduler POSTs with Content-Type, Authorization and X-Scheduler-Token.
    expect(headers["Access-Control-Allow-Methods"]).toBe(ALLOWED_METHODS);
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(headers["Access-Control-Allow-Headers"]).toContain("X-Scheduler-Token");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
    // GET/PUT/DELETE were never used and are no longer advertised.
    expect(headers["Access-Control-Allow-Methods"]).not.toContain("GET");
    expect(headers["Access-Control-Allow-Methods"]).not.toContain("DELETE");
  });
});
