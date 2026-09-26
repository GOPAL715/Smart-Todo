/**
 * Shown instead of the application when the Supabase connection settings are
 * missing or still hold `.env.example` placeholders.
 *
 * This exists so a misconfigured build fails with one actionable sentence
 * rather than a blank page followed by a stream of opaque "Failed to fetch"
 * network errors on every screen.
 */
export function ConfigurationNotice({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="card p-8 max-w-lg w-full">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
          Setup required
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">{message}</p>
        <ol className="text-sm text-neutral-600 dark:text-neutral-400 list-decimal list-inside space-y-1">
          <li>
            Copy <code className="font-mono text-xs">.env.example</code> to{" "}
            <code className="font-mono text-xs">.env</code> in the project root.
          </li>
          <li>
            Fill in <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> from
            Supabase → Project Settings → API.
          </li>
          <li>Restart the dev server, or redeploy with the variables set.</li>
        </ol>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-4">
          Use the publishable (anon) key only. Never expose the service_role key
          to the browser.
        </p>
      </div>
    </div>
  );
}
