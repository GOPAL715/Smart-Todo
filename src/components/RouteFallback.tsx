/**
 * The placeholder shown while a lazily-loaded route's chunk is in flight.
 *
 * Without this the app would render a blank content area for the duration of
 * the request, which reads as a broken page rather than a loading one.
 *
 * Sizing is deliberate. A lazy route renders inside the application shell's
 * outlet, so a full-screen (`min-h-screen`) placeholder would cover the sidebar
 * and collapse the layout twice — once when the page unmounts, again when the
 * real content arrives. Reserving a smaller, fixed block of space keeps the
 * sidebar and header steady and leaves only the content column briefly empty.
 *
 * The markup reuses the spinner's exact styling from `ProtectedRoute` and the
 * notification panel, so every loading state in the app looks the same. The
 * status role with a polite live region announces the wait to a screen reader
 * without interrupting whatever the user was doing.
 */
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[16rem] flex flex-col items-center justify-center gap-3"
    >
      <div
        className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"
        aria-hidden="true"
      />
      <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
    </div>
  );
}
