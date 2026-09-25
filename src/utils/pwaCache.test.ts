import { describe, expect, it } from "vitest";
import { isAuthenticatedApiCacheName } from "./pwaCache";

describe("isAuthenticatedApiCacheName", () => {
  it("identifies only the legacy authenticated API cache", () => {
    expect(isAuthenticatedApiCacheName("supabase-api-data")).toBe(true);
    expect(isAuthenticatedApiCacheName("supabase-api-data-v1")).toBe(true);
    expect(isAuthenticatedApiCacheName("workbox-precache-v2")).toBe(false);
    expect(isAuthenticatedApiCacheName("google-fonts-webfonts")).toBe(false);
  });
});
