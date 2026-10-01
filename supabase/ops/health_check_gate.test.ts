import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain ESM module with JSDoc types; TypeScript is not used to
// typecheck this file (tsconfig.app.json only includes `src`), and Vitest
// resolves it at runtime.
import {
  parseHealthCheckOutput,
  evaluateHealthCheck,
  renderSummary,
  runGate,
  redactSecrets,
} from "./health_check_gate.mjs";

/*
 * The gate is the only part of the health check that can fail a script, so it
 * gets a real test suite. `health_check.sql` itself is not unit tested — it is
 * verified against a real database by `supabase/tests/scheduler_retention.sql`
 * and `supabase/ops/RUNBOOK.md`, which is the appropriate place for SQL
 * assertions.
 *
 * These tests use fabricated, obviously fake credentials. No real secret, and no
 * connection to any database, is involved.
 */

const HEALTHY_OUTPUT = [
  "CREATE FUNCTION",
  "db|PASS|connected; smarttodo on pg 17; applied migrations: 26",
  "cron_job|PASS|1 job(s); active=true; schedule=* * * * *",
  "recent_runs|PASS|1 run(s); newest 2026-09-27 10:00:00+00",
  "dispatch_errors|PASS|no error rows",
  "pg_net_responses|PASS|57 response(s) in the last hour; ok=57",
  "scheduler_token|PASS|token present in Vault (value not displayed)",
  "reminder_backlog|PASS|unsent reminders already past due: 0",
  "reminder_uniqueness|PASS|unique index present; duplicate sends are prevented",
  "retention|PASS|28741 retained run row(s); oldest 2026-08-28 10:00:00+00",
].join("\n");
describe("parseHealthCheckOutput", () => {
  it("parses every result row", () => {
    const results = parseHealthCheckOutput(HEALTHY_OUTPUT);
    expect(results).toHaveLength(9);
    expect(results[0]).toEqual({
      check: "db",
      status: "PASS",
      detail: "connected; smarttodo on pg 17; applied migrations: 26",
    });
  });

  it("ignores the statement echo and blank lines", () => {
    // `psql` prints the applied statement before the results. Treating it as a
    // failure would make every run look broken.
    const results = parseHealthCheckOutput(`CREATE FUNCTION\n\n${HEALTHY_OUTPUT}\n\n`);
    expect(results.every((r) => r.check !== "CREATE FUNCTION")).toBe(true);
    expect(results).toHaveLength(9);
  });

  it("keeps a pipe that appears inside the detail text", () => {
    // Detail is free-form; only the first two separators are structural.
    const results = parseHealthCheckOutput("db|PASS|connected | ok | really");
    expect(results[0].detail).toBe("connected | ok | really");
  });

  it("ignores an unknown status rather than trusting it", () => {
    const results = parseHealthCheckOutput("db|MAYBE|unsure\nreal|PASS|fine");
    expect(results).toHaveLength(1);
    expect(results[0].check).toBe("real");
  });

  it("returns nothing for a non-string input", () => {
    expect(parseHealthCheckOutput(undefined as unknown as string)).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseHealthCheckOutput("db|PASS|connected\r\ncron_job|PASS|active\r\n")).toHaveLength(2);
  });
});

describe("evaluateHealthCheck", () => {
  it("passes when every check is healthy", () => {
    const evaluation = evaluateHealthCheck(parseHealthCheckOutput(HEALTHY_OUTPUT));
    expect(evaluation.ok).toBe(true);
    expect(evaluation.failures).toHaveLength(0);
    expect(evaluation.parsed).toBe(9);
  });

  it("fails when any check fails", () => {
    const evaluation = evaluateHealthCheck(parseHealthCheckOutput(FAILED_OUTPUT));
    expect(evaluation.ok).toBe(false);
    expect(evaluation.failures.map((f) => f.check)).toEqual(["recent_runs"]);
  });

  it("does not fail the gate on a warning", () => {
    // The scheduler runs every minute, so a 2-5 minute gap is normal jitter.
    // Failing on it would make people ignore the alert.
    const evaluation = evaluateHealthCheck(
      parseHealthCheckOutput("db|PASS|connected\npg_net_responses|WARN|0 responses in the last hour")
    );
    expect(evaluation.ok).toBe(true);
    expect(evaluation.warnings.map((w) => w.check)).toEqual(["pg_net_responses"]);
  });

describe("runGate — exit status", () => {
  it("exits 0 when production is healthy", () => {
    expect(runGate(HEALTHY_OUTPUT).exitCode).toBe(0);
  });

  it("exits 1 when a check fails", () => {
    expect(runGate(FAILED_OUTPUT).exitCode).toBe(1);
  });

  it("exits 1 when the connection failed and nothing was parsed", () => {
    // The most important case: a broken check must not read as a healthy one.
    expect(runGate("psql: error: connection to server failed").exitCode).toBe(1);
  });

  it("exits 1 for completely empty output", () => {
    expect(runGate("").exitCode).toBe(1);
  });

  it("exits 0 when there are warnings but no failures", () => {
    const out = runGate("db|PASS|connected\nretention|WARN|61000 rows");
    expect(out.exitCode).toBe(0);
    expect(out.summary).toMatch(/Warnings \(not failing the gate\): retention/);
  });

  it("reports the failing check by name in the summary", () => {
    expect(runGate(FAILED_OUTPUT).summary).toMatch(/Failed checks: recent_runs/);
  });

  it("says so explicitly when nothing was parsed", () => {
    expect(runGate("garbage").summary).toMatch(/RESULT: FAIL \(no health-check results/);
  });
});

describe("renderSummary", () => {
  it("distinguishes 'unhealthy' from 'did not run'", () => {
    // Both fail, but an operator needs to know which: an outage versus a broken
    // or misconfigured check are completely different investigations.
    const unparsed = renderSummary([], evaluateHealthCheck([]));
    const unhealthy = renderSummary(
      parseHealthCheckOutput("recent_runs|FAIL|no dispatch"),
      evaluateHealthCheck(parseHealthCheckOutput("recent_runs|FAIL|no dispatch"))
    );

    expect(unparsed).toMatch(/the check did not run/);
    expect(unhealthy).toMatch(/Failed checks: recent_runs/);
    expect(unhealthy).not.toMatch(/did not run/);
  });

  it("lists every failing check when more than one fails", () => {
    const raw = "cron_job|FAIL|inactive\nrecent_runs|FAIL|no dispatch";
    const summary = renderSummary(parseHealthCheckOutput(raw), evaluateHealthCheck(parseHealthCheckOutput(raw)));
    expect(summary).toMatch(/Failed checks: cron_job, recent_runs/);
  });
});

describe("redactSecrets — no credential reaches the job log", () => {
  // CI logs are retained and readable by anyone with repository access, so the
  // gate masks anything credential-shaped even though the SQL should never emit
  // one. Over-redacting an operational detail is harmless; under-redacting a
  // credential is not.
  const FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.TOTALLYSECRETPARTSIGNATURE";
  const FAKE_PASSWORD_URL = "postgresql://postgres.fakeproject:hunter2notreal@aws-0-region.pooler.supabase.com:5432/postgres";

  it("masks a JWT-shaped value", () => {
    const redacted = redactSecrets(`token present; value ${FAKE_JWT}`);
    expect(redacted).not.toContain("TOTALLYSECRETPARTSIGNATURE");
    expect(redacted).toMatch(/\[redacted-jwt\]/);
  });

  it("masks the password in a connection string", () => {
    const redacted = redactSecrets(`could not reach ${FAKE_PASSWORD_URL}`);
    expect(redacted).not.toContain("hunter2notreal");
    expect(redacted).toMatch(/\[redacted\]@/);
  });

  it("masks a bearer token", () => {
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
  });

  it("masks an sb_ secret key", () => {
    expect(redactSecrets("sb_secret_abcdefghijklmnop")).toMatch(/\[redacted-key\]/);
  });

  it("leaves ordinary operational detail intact", () => {
    // Redaction must not destroy the information an operator needs.
    const detail = "1 job(s); active=true; schedule=* * * * *; 57 response(s); ok=57";
    expect(redactSecrets(detail)).toBe(detail);
  });

  it("keeps secrets out of the rendered summary", () => {
    const out = runGate(`db|PASS|connected via ${FAKE_JWT}`);
    expect(out.summary).not.toContain("TOTALLYSECRETPARTSIGNATURE");
  });
});

  it("fails closed when nothing could be parsed", () => {
    // A monitoring check that goes quiet because it broke must not look healthy.
    expect(evaluateHealthCheck([]).ok).toBe(false);
  });
});


const FAILED_OUTPUT = [
  "db|PASS|connected; smarttodo on pg 17",
  "cron_job|PASS|1 job(s); active=true",
  "recent_runs|FAIL|no run in the last 5 minutes",
  "retention|PASS|28741 retained run row(s)",
].join("\n");

/*
 * CLI REGRESSION — why these tests spawn a child process
 *
 * Every test above imports `runGate`, which can only ever prove the *policy* is
 * right. It cannot prove the gate runs as a script at all, and that is exactly
 * what broke in production.
 *
 * The entry-point guard used to compare `import.meta.url` against
 * `new URL(`file:///${process.argv[1]}`)`. On Windows the template happens to
 * match; on POSIX `process.argv[1]` is absolute, so the template produced four
 * slashes and never matched `import.meta.url`. The CLI block was therefore
 * skipped on `ubuntu-latest`: no summary was printed and the process exited 0
 * unconditionally, so a genuine `FAIL` still produced a green workflow run.
 *
 * An imported `runGate` test cannot catch that, so these tests execute the real
 * entry point with `process.execPath` and assert the actual exit status. The
 * path is resolved from `import.meta.url`, so the same code runs on Windows and
 * on `ubuntu-latest`, where CI is what validates the POSIX branch.
 */
const GATE_SCRIPT = fileURLToPath(new URL("./health_check_gate.mjs", import.meta.url));

function runGateCli(args: string[]) {
  return spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("CLI entry point (executed as a real child process)", () => {
  it("exits 0 on PASS input and prints the summary", () => {
    const result = runGateCli([HEALTHY_OUTPUT]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SmartTodo production health check/);
    expect(result.stdout).toMatch(/RESULT: PASS \(9 checks\)/);
  });

  it("exits 0 on WARN-only input, because WARN is not fatal", () => {
    const result = runGateCli(["recent_runs|WARN|no run in the last 2-5 minutes"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\[WARN\] recent_runs/);
    expect(result.stdout).toMatch(/RESULT: PASS \(1 checks\)/);
  });

  it("exits non-zero on FAIL input — the regression that matters", () => {
    // A `FAIL` reaching the actual CLI must never exit 0. While the guard was
    // broken on POSIX this returned 0 with no output, which is what let an
    // unhealthy production look green.
    const result = runGateCli([FAILED_OUTPUT]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Failed checks: recent_runs/);
    expect(result.stdout).toMatch(/RESULT: FAIL/);
  });

  it("exits non-zero on malformed, unparseable input", () => {
    const result = runGateCli(["psql: error: connection failed"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/RESULT: FAIL \(no health-check results/);
  });

  it("exits non-zero when no health-check results are supplied at all", () => {
    // No argument at all, and an explicitly empty one, must both fail closed.
    expect(runGateCli([]).status).not.toBe(0);
    expect(runGateCli([""]).status).not.toBe(0);
  });

  it("does not execute the CLI when the module is merely imported", () => {
    // Importing must stay side-effect free: a passing import proves the guard did
    // not fire, and therefore that the CLI tests above exercised the real path.
    expect(runGate(HEALTHY_OUTPUT).exitCode).toBe(0);
    expect(runGate(FAILED_OUTPUT).exitCode).toBe(1);
  });
});
