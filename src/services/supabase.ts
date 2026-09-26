import { createClient } from "@supabase/supabase-js";
import { readSupabaseEnv, INVALID_SUPABASE_URL } from "@/utils/env";

const result = readSupabaseEnv({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/**
 * A non-null description of the configuration problem, or null when the app is
 * correctly configured. `App` renders a dedicated setup screen when this is set,
 * so a misconfigured build never reaches routing, auth, or any query.
 *
 * The message is operator guidance only; it never echoes the offending value.
 */
export const supabaseConfigError: string | null = result.ok ? null : result.message;

/**
 * A client is exported unconditionally so every service keeps the same import
 * shape. When the configuration is invalid this instance points at a
 * non-resolvable sentinel host and is never used, because `App` renders the
 * configuration error instead of the application. This replaces the previous
 * behaviour of throwing at module scope, which surfaced as a blank page.
 */
export const supabase = createClient(
  result.ok ? result.url : INVALID_SUPABASE_URL,
  result.ok ? result.anonKey : "invalid-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
