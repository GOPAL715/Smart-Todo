import { describe, expect, it } from "vitest";
import { normalizeAppError, getActionErrorMessage, type AppErrorCategory } from "./appError";
import { getServiceErrorMessage } from "./serviceErrors";
import { getAuthErrorMessage } from "./authErrors";

/*
 * Every value below is fabricated. No real credential, host, or connection
 * string appears in this file, and nothing here contacts a database.
 */

/** A Supabase Auth error shape: `status` present, no PostgREST detail fields. */
const authError = (code: string, message = "auth failure") => ({
  code,
  message,
  status: 400,
});

/** A PostgREST error shape: `details`/`hint` present. */
const pgError = (
  code: string,
  message = "database failure",
  extra: Record<string, unknown> = {}
) => ({ code, message, details: "some detail", hint: null, ...extra });

describe("normalizeAppError — delegation", () => {
  it("takes its auth copy from the auth mapper", () => {
    const error = authError("invalid_credentials", "Invalid login credentials");
    expect(normalizeAppError(error).message).toBe(getAuthErrorMessage(error));
  });

  it("takes its service copy from the service mapper", () => {
    const error = pgError("42501", "new row violates row-level security policy");
    expect(normalizeAppError(error).message).toBe(getServiceErrorMessage(error));
  });

  it("never invents copy of its own for a known shape", () => {
    // The taxonomy labels errors; the mappers write them. If this ever fails, a
    // third source of user-facing text has crept in.
    for (const error of [authError("weak_password"), pgError("42501"), pgError("ECONNRESET")]) {
      const normalized = normalizeAppError(error);
      expect([getAuthErrorMessage(error), getServiceErrorMessage(error)]).toContain(
        normalized.message
      );
    }
  });
});

describe("normalizeAppError — categories", () => {
  const cases: [string, unknown, AppErrorCategory][] = [
    ["an auth failure", authError("invalid_credentials"), "auth"],
    ["a weak password", authError("weak_password"), "auth"],
    ["an expired link", authError("otp_expired"), "auth"],
    ["a unique violation", pgError("23505"), "conflict"],
    ["a foreign key violation", pgError("23503"), "conflict"],
    ["a not-null violation", pgError("23502"), "validation"],
    ["a check violation", pgError("23514"), "validation"],
    ["a missing row", pgError("PGRST116"), "not_found"],
    ["an RLS denial", pgError("42501"), "permission"],
    ["an undefined table", pgError("42P01"), "permission"],
    ["a connection reset", pgError("ECONNRESET"), "network"],
    ["a pooler error", pgError("PGRST301"), "network"],
    ["a server error", pgError("XX000", "boom", { status: 503 }), "server"],
  ];

  for (const [label, error, expected] of cases) {
    it(`classifies ${label} as ${expected}`, () => {
      expect(normalizeAppError(error).category).toBe(expected);
    });
  }

describe("normalizeAppError — retryability", () => {
  const nonRetryable: [string, unknown][] = [
    ["a validation failure", pgError("23502")],
    ["a permission failure", pgError("42501")],
    ["an auth failure", authError("invalid_credentials")],
    ["a not-found failure", pgError("PGRST116")],
    ["a conflict", pgError("23505")],
    ["an unknown plain error", new Error("boom")],
    ["a non-error", null],
  ];

  for (const [label, error] of nonRetryable) {
    it(`treats ${label} as not retryable`, () => {
      expect(normalizeAppError(error).retryable).toBe(false);
    });
  }

  it("treats a connectivity failure as retryable", () => {
    expect(normalizeAppError(pgError("ECONNREFUSED")).retryable).toBe(true);
  });

  it("treats a fetch failure as retryable", () => {
    expect(normalizeAppError(new Error("Failed to fetch")).retryable).toBe(true);
  });

  it("treats a transient server failure as retryable", () => {
    expect(normalizeAppError(pgError("XX000", "boom", { status: 503 })).retryable).toBe(true);
  });

  it("is metadata only — it never performs a retry itself", () => {
    // Nothing in this module performs I/O, so `retryable` cannot by itself cause
    // a request. A pure classification is the only thing returned.
    const result = normalizeAppError(pgError("ECONNREFUSED"));
    expect(Object.keys(result).sort()).toEqual(["category", "message", "retryable"]);
  });
});

describe("normalizeAppError — pinning the mappers' transient copy", () => {
  it("recognises the service mapper's connectivity sentence as retryable", () => {
    // If serviceErrors is reworded this fails rather than silently changing which
    // errors the UI offers to retry.
    const error = pgError("ECONNREFUSED");
    expect(normalizeAppError(error).message).toBe(getServiceErrorMessage(error));
    expect(normalizeAppError(error).retryable).toBe(true);
  });

  it("does not mark a generic message retryable", () => {
    expect(normalizeAppError(pgError("XX000", "unexpected")).retryable).toBe(false);
  });
});

describe("normalizeAppError — already-normalized errors", () => {
  it("classifies a service-thrown Error as unknown rather than guessing", () => {
    // Services throw `new Error(getServiceErrorMessage(err))`, which discards the
    // provider detail. Re-deriving a category from the safe sentence would be
    // guesswork, so it is reported honestly as unknown.
    const thrown = new Error(getServiceErrorMessage(pgError("42501")));
    expect(normalizeAppError(thrown).category).toBe("unknown");
  });

  it("re-derives the message rather than trusting a bare Error", () => {
    // A thrown service message is safe, but a bare `Error` is not necessarily
    // mapper-produced, so the text is re-derived instead of passed through.
    const thrown = new Error("permission denied for table tasks");
    const normalized = normalizeAppError(thrown);

    expect(normalized.message).toBe(getServiceErrorMessage(thrown));
    expect(normalized.message).not.toMatch(/table tasks/i);
  });

  it("still detects a connectivity failure carried as an Error message", () => {
    expect(normalizeAppError(new Error("Failed to fetch")).category).toBe("network");
  });

  it("keeps a connectivity failure retryable when carried as an Error", () => {
    expect(normalizeAppError(new Error("Failed to fetch")).retryable).toBe(true);
  });
});


describe("no technical detail escapes", () => {
  // Fabricated values shaped like real ones. No real credential is used.
  const LEAKS: [string, string][] = [
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SIGNATUREPART"],
    ["a service-role key", "eyJhbGciOiJIUzI1NiIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.FAKESIG"],
    ["a bearer token", "Bearer faketokenvalue123"],
    [
      "a database url",
      "postgresql://postgres:supersecretpassword@db.internal.example.com:5432/postgres",
    ],
    ["a host name", "db.internal.example.com"],
  ];

  for (const [label, secret] of LEAKS) {
    it(`does not return ${label} from a provider error`, () => {
      const normalized = normalizeAppError(
        pgError("42501", `permission denied for table tasks: ${secret}`)
      );
      expect(normalized.message).not.toContain(secret);
    });

    it(`does not return ${label} from an auth error`, () => {
      const normalized = normalizeAppError(
        authError("invalid_credentials", `Invalid login credentials ${secret}`)
      );
      expect(normalized.message).not.toContain(secret);
    });
  }

  it("never returns a raw provider message", () => {
    const raw = 'duplicate key value violates unique constraint "tasks_pkey"';
    expect(normalizeAppError(pgError("23505", raw)).message).not.toContain("tasks_pkey");
  });

  it("never returns a SQLSTATE code", () => {
    expect(normalizeAppError(pgError("42501")).message).not.toContain("42501");
  });

  it("never returns a stack trace", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at doThing (app.js:1:1)";
    expect(normalizeAppError(error).message).not.toContain("app.js");
  });

  it("falls back to safe generic copy for an unrecognised value", () => {
    expect(normalizeAppError(undefined).message).toBe("Something went wrong. Please try again.");
  });
});

describe("getActionErrorMessage", () => {
  const FALLBACK = "Could not start task. Please try again.";

  it("keeps the operation-specific copy for an ordinary failure", () => {
    expect(getActionErrorMessage(pgError("23505"), FALLBACK)).toBe(FALLBACK);
  });

  it("keeps the operation-specific copy for a permission failure", () => {
    expect(getActionErrorMessage(pgError("42501"), FALLBACK)).toBe(FALLBACK);
  });

  it("lets a connectivity failure speak for itself", () => {
    // "Check your internet connection" is more actionable than telling the user
    // to retry the same failing action.
    const message = getActionErrorMessage(pgError("ECONNREFUSED"), FALLBACK);
    expect(message).toMatch(/connection/i);
    expect(message).not.toBe(FALLBACK);
  });

  it("falls back safely for a non-error", () => {
    expect(getActionErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  it("never returns raw provider text through the action helper", () => {
    const message = getActionErrorMessage(
      pgError("42501", "permission denied for table tasks"),
      FALLBACK
    );
    expect(message).not.toMatch(/table tasks|permission denied/i);
  });

  it("does not downgrade the operation copy to a generic message", () => {
    // The service threw a safe, specific message that normalizeAppError cannot
    // classify; the screen's own copy is used instead of "Something went wrong".
    const thrown = new Error("You do not have permission to perform this action.");
    expect(getActionErrorMessage(thrown, FALLBACK)).toBe(FALLBACK);
  });
});

});
