export async function clearAuthenticatedCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  for (const name of names) {
    if (name === "workbox-precache-v2" || name.startsWith("workbox-precache")) continue;
    await caches.delete(name);
  }
}
