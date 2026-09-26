import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it and shows a recovery screen
 * instead of an unhandled exception, which React surfaces as a blank page.
 *
 * Scope notes:
 * - No stack traces or raw error text reach the user. `getDerivedStateFromError`
 *   stores only a boolean, so the message cannot leak internals.
 * - Diagnostics go to the console, and only outside production. Development
 *   builds also record the component stack, which is what makes the error
 *   actionable locally. Nothing is sent anywhere.
 * - It is a class component because `getDerivedStateFromError` and
 *   `componentDidCatch` have no hook equivalent.
 * - The boundary is stateless with respect to auth and routing: it neither
 *   reads nor mutates either, so wrapping the app cannot interfere with them.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("Unhandled application error:", error);
      console.error("Component stack:", info.componentStack);
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
        <div className="card p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
            The app hit an unexpected error and stopped. Reloading the page usually
            fixes it. If it keeps happening, please try again later.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="btn-secondary"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
