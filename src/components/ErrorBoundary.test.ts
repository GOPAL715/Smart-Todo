import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

/*
 * The project has no DOM test environment (no jsdom / happy-dom /
 * @testing-library), so this exercises the boundary's state transition and its
 * logging behaviour directly rather than through a rendered tree. A full render
 * test should be added if a DOM environment is introduced.
 */
describe("ErrorBoundary", () => {
  it("starts without an error", () => {
    const boundary = new ErrorBoundary({ children: null });
    expect(boundary.state.hasError).toBe(false);
  });

  it("records the error state when a child throws", () => {
    const state = ErrorBoundary.getDerivedStateFromError();
    expect(state).toEqual({ hasError: true });
  });

  it("does not retain the error object, so internals cannot leak to the UI", () => {
    // Only a boolean flag is stored; the thrown message is never part of state,
    // so a stack trace or token cannot reach the rendered fallback.
    const state = ErrorBoundary.getDerivedStateFromError() as unknown as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(["hasError"]);
    expect(JSON.stringify(state)).not.toContain("SECRET_TOKEN_VALUE");
  });

  it("logs the error and component stack in development", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error("boom");

    boundary.componentDidCatch(error, { componentStack: "in App" } as never);

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join(" ");
    expect(logged).toContain("Unhandled application error");
    // componentDidCatch runs only outside production, so nothing is emitted in
    // a production build.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
