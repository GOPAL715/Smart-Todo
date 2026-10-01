import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The native Chromium date/time picker palette is chosen by the CSS
 * `color-scheme` property, not by any class on the page. The app themes itself
 * with a `dark` class on <html>, so the fix is that `color-scheme` follows that
 * same class.
 *
 * These tests read the real stylesheet rather than restating the rules, so they
 * fail if the declaration is ever removed or the selector drifts from the class
 * ThemeProvider actually toggles. They are intentionally static: jsdom does not
 * implement `color-scheme` or native pickers, so a computed-style assertion
 * would be theatre. The visual confirmation is a manual browser check.
 *
 * Paths are resolved from the project root rather than through
 * `new URL(..., import.meta.url)`, which Vite rewrites into an asset reference
 * at build time and which would leave `readFileSync` holding a bundled URL.
 */
const projectFile = (...segments: string[]) => resolve(process.cwd(), ...segments);

describe("native picker color-scheme (index.css)", () => {
  const css = readFileSync(projectFile("src", "index.css"), "utf8");

  it("declares a light scheme by default", () => {
    expect(css).toMatch(/html\s*\{[^}]*color-scheme:\s*light/);
  });

  it("declares a dark scheme on the same element the theme toggles", () => {
    // Must key off the `dark` class on <html>, which is exactly what
    // ThemeProvider's applyClass() adds and removes.
    expect(css).toMatch(/html\.dark\s*\{[^}]*color-scheme:\s*dark/);
  });

  it("is applied through CSS only, with no inline or scripted scheme override", () => {
    // A JS color-scheme write would be a second source of truth that could
    // disagree with the `dark` class.
    expect(css).not.toMatch(/colorScheme/);
  });

  it("leaves the existing input component styling untouched", () => {
    // The field itself must keep its own classes; only the UA popup scheme
    // changes.
    expect(css).toMatch(/\.input\s*\{/);
    expect(css).toContain("dark:bg-neutral-800");
  });

  it("does not restyle native pickers by hand", () => {
    // No pseudo-element hacks or third-party picker styling crept in.
    expect(css).not.toMatch(/::-webkit-calendar-picker-indicator/);
    expect(css).not.toMatch(/::-webkit-datetime-edit/);
  });

  it("leaves the task date/time input types in the document", () => {
    // The fix must theme the native controls, not remove them.
    const taskForm = readFileSync(
      projectFile("src", "pages", "TaskFormPage.tsx"),
      "utf8"
    );
    expect(taskForm).toContain('type="date"');
    expect(taskForm).toContain('type="time"');
    // Existing reconciliation and validation behaviour must survive.
    expect(taskForm).toContain("reconcileEndTime");
    expect(taskForm).toContain("validateTimeRange");
  });
});