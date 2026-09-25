export const AUTHENTICATED_API_CACHE_NAME = "supabase-api-data";

export function isAuthenticatedApiCacheName(name: string): boolean {
  return name === AUTHENTICATED_API_CACHE_NAME || name.startsWith(`${AUTHENTICATED_API_CACHE_NAME}-`);
}

/**
 * Remove the legacy authenticated Supabase runtime cache during sign-out.
 * Current builds do not create this cache, but clearing it protects users
 * upgrading from a service worker that cached authenticated API responses.
 * App-shell and font caches are intentionally preserved.
 */
export async function clearAuthenticatedCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const names = await caches.keys();
  for (const name of names) {
    if (isAuthenticatedApiCacheName(name)) {
      await caches.delete(name);
    }
  }
}
