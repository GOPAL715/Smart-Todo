import { describe, expect, it } from "vitest";
import { readSupabaseEnv } from "./env";

/** A structurally valid publishable key. Not a real credential. */
const VALID_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMCJ9.not-a-real-signature";
const VALID_URL = "https://abcdefghijklmnop.supabase.co";

describe("readSupabaseEnv", () => {
  it("accepts a correctly configured project", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: VALID_URL,
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(VALID_URL);
      expect(result.anonKey).toBe(VALID_KEY);
    }
  });

  it("rejects the .env.example placeholder url", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: "https://your-supabase-url.example.com",
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("placeholder_url");
  });

  it("rejects the .env.example placeholder anon key", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: VALID_URL,
      VITE_SUPABASE_ANON_KEY: "your-supabase-anon-key-here",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("placeholder_anon_key");
  });

  it("rejects missing settings with a distinct code for each", () => {
    const noUrl = readSupabaseEnv({ VITE_SUPABASE_ANON_KEY: VALID_KEY });
    expect(noUrl.ok).toBe(false);
    if (!noUrl.ok) expect(noUrl.code).toBe("missing_url");

    const noKey = readSupabaseEnv({ VITE_SUPABASE_URL: VALID_URL });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.code).toBe("missing_anon_key");

    const neither = readSupabaseEnv({});
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.code).toBe("missing_url");
  });

  it("treats whitespace-only values as missing", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: "   ",
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing_url");
  });

  it("rejects a non-absolute url", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: "not-a-url",
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_url");
  });

  it("rejects a non-https url", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: "http://abcdefghijklmnop.supabase.co",
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_url");
  });

  it("rejects a key that is not shaped like a publishable key", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: VALID_URL,
      VITE_SUPABASE_ANON_KEY: "definitely-not-a-key",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_anon_key");
  });

  it("accepts the newer sb_publishable_ key format", () => {
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: VALID_URL,
      VITE_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop",
    });
    expect(result.ok).toBe(true);
  });

  it("never echoes the offending value in the error message", () => {
    const secretish = "your-supabase-anon-key-here";
    const result = readSupabaseEnv({
      VITE_SUPABASE_URL: VALID_URL,
      VITE_SUPABASE_ANON_KEY: secretish,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(secretish);
      // Actionable: it must say what to do, not just that something is wrong.
      expect(result.message.length).toBeGreaterThan(20);
    }
  });
});
