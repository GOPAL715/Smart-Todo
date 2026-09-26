/**
 * Fixed-size batching for PostgREST `.in()` lookups.
 *
 * PostgREST sends `in` filters as query parameters, so an unbounded list
 * eventually produces a URL past any practical length. Batching keeps the
 * request bounded without changing what data comes back.
 *
 * Shared by task and tag lookups so both bound identically.
 */

export const DEFAULT_BATCH_SIZE = 200;

/** Splits ids into fixed-size batches, preserving order. */
export function chunkIds(ids: string[], size: number = DEFAULT_BATCH_SIZE): string[][] {
  if (size <= 0) return [ids];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}
