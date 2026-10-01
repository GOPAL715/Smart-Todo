#!/usr/bin/env node
/**
 * Turns the human-readable output of `health_check.sql` into a deterministic
 * PASS / FAIL exit status.
 *
 * WHY THIS EXISTS
 *   `health_check.sql` already reports one row per check with a `PASS` / `WARN` /
 *   `FAIL` status, but that is a report for a person reading a terminal. Nothing
 *   about it can fail a script, so an operator had to notice a red result
 *   themselves. This wrapper is the machine-readable contract: it reads those
 *   rows, applies a single explicit policy, and exits non-zero when production is
 *   unhealthy. It performs no queries of its own, so the SQL stays the single
 *   source of truth for what "healthy" means and is not duplicated here.
 *
 * POLICY: only `FAIL` fails the gate.
 *   `WARN` is deliberately non-fatal. The scheduler fires every minute, so a run
 *   that is 2-5 minutes old is ordinary jitter, not an outage; failing the gate
 *   on it would train everyone to ignore the alert. `WARN` is still counted and
 *   printed so degradation stays visible.
 *
 * FAIL-CLOSED
 *   Output that cannot be parsed at all is reported as a failure rather than a
 *   pass. A monitoring check that goes quiet because it broke is worse than no
 *   monitoring, because it looks identical to a healthy system.
 *
 * SECRETS
 *   The SQL is written to print no secret material. This wrapper adds a second,
 *   independent layer: any token-shaped or connection-string-shaped substring in
 *   a check's detail is redacted before the detail is printed or written to a
 *   job log. CI output is retained and visible to anyone with repository access.
 *
 * This module is dependency-free ESM so the scheduled workflow can run it
 * directly with no build step.
 */

// Node built-in only; no dependency is added.
import { pathToFileURL } from "node:url";

/** @typedef {{ check: string, status: string, detail: string }} CheckResult */

/** Delimiter used by `psql -t -A -F '|'` to separate the three columns. */
const COLUMN_SEPARATOR = "|";

/**
 * Only `FAIL` fails the gate. `WARN` does not — see the policy note above.
 * @param {string} status
 * @returns {boolean}
 */
function isFatalStatus(status) {
  return status === "FAIL";
}

/**
 * Splits one result row. Detail text is free-form and may legitimately contain a
 * pipe, so only the first two separators are consumed and the remainder is
 * preserved.
 */
function splitRow(line) {
  const first = line.indexOf(COLUMN_SEPARATOR);
  if (first === -1) return null;
  const second = line.indexOf(COLUMN_SEPARATOR, first + 1);
  if (second === -1) return null;
  return [
    line.slice(0, first).trim(),
    line.slice(first + 1, second).trim(),
    line.slice(second + 1).trim(),
  ];
}

function isKnownStatus(status) {
  return status === "PASS" || status === "WARN" || status === "FAIL";
}
/**
 * Masks anything credential-shaped before it reaches a terminal or a CI log.
 *
 * Deliberately broad: over-redacting an operational detail is harmless, whereas
 * under-redacting a credential is not.
 *
 * @param {string} value
 * @returns {string}
 */
export function redactSecrets(value) {
  return String(value)
    // JSON Web Tokens (Supabase anon / service-role keys are `eyJ...`).
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*/g, "[redacted-jwt]")
    // Newer Supabase secret / publishable key prefixes.
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    // Bearer tokens, however produced.
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    // The password component of a Postgres connection string.
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1[redacted]@")
    // A Vault secret value, however it might be labelled.
    .replace(/\b(vault secret value)\s*[:=]\s*\S+/gi, "$1: [redacted]");
}

/**
 * Parses `psql -t -A -F '|'` output from `health_check.sql`.
 *
 * Lines that are not result rows — the `CREATE FUNCTION` notice, psql banners,
 * blank lines, or an error message — are ignored rather than treated as
 * failures, so ordinary psql noise cannot raise a false alarm.
 *
 * @param {string} raw
 * @returns {CheckResult[]}
 */
export function parseHealthCheckOutput(raw) {
  /** @type {CheckResult[]} */
  const results = [];
  if (typeof raw !== "string") return results;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = splitRow(trimmed);
    if (!parts) continue;
    const [check, status, detail] = parts;
    if (!check || !isKnownStatus(status)) continue;
    results.push({ check, status, detail });
  }

  return results;
}

/**
 * Applies the gate policy.
 *
 * @param {CheckResult[]} results
 * @returns {{ ok: boolean, failures: CheckResult[], warnings: CheckResult[], parsed: number }}
 */
export function evaluateHealthCheck(results) {
  const failures = results.filter((r) => isFatalStatus(r.status));
  const warnings = results.filter((r) => r.status === "WARN");

  // No parseable rows means the check did not run, or its output changed shape.
  // Either way the safe answer is FAIL: silence must never read as health.
  const ok = results.length > 0 && failures.length === 0;

  return { ok, failures, warnings, parsed: results.length };
}

/**
 * Renders the human-readable summary written to the job log.
 *
 * @param {CheckResult[]} results
 * @param {ReturnType<typeof evaluateHealthCheck>} evaluation
 * @returns {string}
 */
export function renderSummary(results, evaluation) {
  const lines = ["SmartTodo production health check", ""];

  for (const r of results) {
    lines.push(`  [${r.status}] ${r.check}: ${redactSecrets(r.detail)}`);
  }

  lines.push("");
  if (!evaluation.ok && evaluation.parsed === 0) {
    lines.push(
      "RESULT: FAIL (no health-check results could be parsed — the check did not run)"
    );
  } else if (evaluation.ok) {
    lines.push(`RESULT: PASS (${evaluation.parsed} checks)`);
  } else {
    const names = evaluation.failures.map((f) => f.check).join(", ");
    lines.push(`RESULT: FAIL (${evaluation.failures.length} of ${evaluation.parsed})`);
    lines.push(`Failed checks: ${names}`);
  }

  if (evaluation.warnings.length > 0) {
    const names = evaluation.warnings.map((w) => w.check).join(", ");
    lines.push(`Warnings (not failing the gate): ${names}`);
  }

  return lines.join("\n");
}

/**
 * @param {string} raw psql output
 * @returns {{ exitCode: number, summary: string }}
 */
export function runGate(raw) {
  const results = parseHealthCheckOutput(raw);
  const evaluation = evaluateHealthCheck(results);
  return {
    // 0 = healthy, 1 = unhealthy. A non-zero exit is what fails the CI job and
    // what fires the GitHub notification.
    exitCode: evaluation.ok ? 0 : 1,
    summary: renderSummary(results, evaluation),
  };
}

// Only act when executed directly, so the module can be imported by tests.
//
// The entry point is compared with `pathToFileURL`, not by string concatenation.
// `new URL(`file:///${process.argv[1]}`)` happens to work on Windows, where the
// path has no leading slash, but on POSIX `process.argv[1]` is absolute
// (`/home/runner/...`), so the template produces four slashes while
// `import.meta.url` has three. The comparison then failed on every Linux
// runner: the CLI block was skipped, nothing was evaluated, and the gate
// exited 0 whatever the health check reported, so a real FAIL still looked
// green in the production monitor.
const entryPoint = process.argv[1];
const invokedDirectly = entryPoint
  ? import.meta.url === pathToFileURL(entryPoint).href
  : false;

if (invokedDirectly) {
  const raw = process.argv[2] ?? "";
  const { exitCode, summary } = runGate(raw);
  process.stdout.write(`${summary}\n`);
  process.exit(exitCode);
}

