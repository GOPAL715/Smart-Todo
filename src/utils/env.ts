/**
 * Startup validation for the Supabase connection settings.
 *
 * Vite inlines `import.meta.env` at build time, so these values are baked into
 * the bundle. They are the Supabase *publishable* (anon) key and project URL,
 * which are designed to be visible to the browser; no secret belongs here.
 *
 * The failure this guards against is a build produced from a `.env` that still
 * holds the `.env.example` placeholders. `createClient` accepts those strings
 * happily, so the app boots and every request then fails deep inside fetch with
 * an opaque "Failed to fetch" that the UI reports as a network problem. That
 * misdirects both users and support. Rejecting placeholders here turns a
 * silent, hard-to-diagnose outage into one explicit, actionable message.
 *
 * The value itself is never echoed into an error message.
 */

/** Values shipped in `.env.example` that must never reach a real build. */
const PLACEHOLDER_URL_FRAGMENTS = [
  "your-supabase-url",
  "example.com",
  "your-project",
  "yourproject",
  "xxxx",
  "changeme",
  "placeholder",
];

const PLACEHOLDER_KEY_FRAGMENTS = [
  "your-supabase-anon-key",
  "your-anon-key",
  "your-key",
  "changeme",
  "placeholder",
  "xxxx",
];

export interface SupabaseEnvOk {
  ok: true;
  url: string;
  anonKey: string;
}

export interface SupabaseEnvError {
  ok: false;
  /** Stable identifier, safe to assert on in tests and logs. */
  code:
    | "missing_url"
    | "missing_anon_key"
    | "placeholder_url"
    | "placeholder_anon_key"
    | "malformed_url"
    | "malformed_anon_key";
  /** Operator-facing guidance. Never contains the offending value. */
  message: string;
}

export type SupabaseEnvResult = SupabaseEnvOk | SupabaseEnvError;

type RawEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

/** A sentinel used so the module always exports a usable client shape. */
export const INVALID_SUPABASE_URL = "https://invalid.supabase-config.local";

/**
 * Publishable keys are JWTs (`eyJ...`), which is what Supabase's legacy anon
 * key format produces. Newer `sb_publishable_` keys are also accepted. Anything
 * else is a placeholder or a misconfiguration.
 */
const ANON_KEY_PATTERN = /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$/;

function looksLikePlaceholder(value: string, fragments: string[]): boolean {
  const normalized = value.toLowerCase();
  return fragments.some((fragment) => normalized.includes(fragment));
}

/**
 * Validates the two required settings. Pure and synchronous so it can run at
 * module scope, be unit tested directly, and be reused by the setup path.
 */
export function readSupabaseEnv(raw: RawEnv): SupabaseEnvResult {
  const url = (raw.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = (raw.VITE_SUPABASE_ANON_KEY ?? "").trim();

  if (!url) {
    return {
      ok: false,
      code: "missing_url",
      message:
        "VITE_SUPABASE_URL is not set. Copy .env.example to .env and set it to your Supabase project URL, e.g. https://<project-ref>.supabase.co",
    };
  }

  if (!anonKey) {
    return {
      ok: false,
      code: "missing_anon_key",
      message:
        "VITE_SUPABASE_ANON_KEY is not set. Copy .env.example to .env and set it to your Supabase publishable (anon) key.",
    };
  }

  if (looksLikePlaceholder(url, PLACEHOLDER_URL_FRAGMENTS)) {
    return {
      ok: false,
      code: "placeholder_url",
      message:
        "VITE_SUPABASE_URL still contains the .env.example placeholder. Set it to your real Supabase project URL, e.g. https://<project-ref>.supabase.co",
    };
  }

  if (looksLikePlaceholder(anonKey, PLACEHOLDER_KEY_FRAGMENTS)) {
    return {
      ok: false,
      code: "placeholder_anon_key",
      message:
        "VITE_SUPABASE_ANON_KEY still contains the .env.example placeholder. Set it to your real Supabase publishable (anon) key from Project Settings → API.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      code: "malformed_url",
      message:
        "VITE_SUPABASE_URL is not a valid URL. It must be an absolute https:// URL, e.g. https://<project-ref>.supabase.co",
    };
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return {
      ok: false,
      code: "malformed_url",
      message:
        "VITE_SUPABASE_URL must use https. Use the URL shown in Supabase → Project Settings → API.",
    };
  }

  if (!ANON_KEY_PATTERN.test(anonKey)) {
    return {
      ok: false,
      code: "malformed_anon_key",
      message:
        "VITE_SUPABASE_ANON_KEY does not look like a Supabase publishable (anon) key. Copy it from Supabase → Project Settings → API. Never use the service_role key here.",
    };
  }

  return { ok: true, url, anonKey };
}
