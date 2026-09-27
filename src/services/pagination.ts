/**
 * Shared pagination primitives for the large user-owned collections.
 *
 * These are deliberately small and pure. The goal of this phase is to replace
 * *silent* truncation — where a user with more rows than the cap was simply
 * never shown the remainder, with no indication it existed — with incremental
 * loading, while leaving every existing filter, search, sort and ranking
 * behaviour exactly where it already lives.
 *
 * Two properties matter and are enforced here rather than at each call site:
 *
 * 1. **Deterministic ordering.** Offset pagination can only be correct if the
 *    database returns a total order. Ordering by a non-unique column (the task
 *    list's `start_datetime`, for example) leaves ties in an arbitrary order, so
 *    a row that was page 1's last item can reappear on page 2, or be skipped
 *    entirely. `REQUIRED_TIEBREAKER` is appended to every paged query as a final
 *    unique sort key, which makes the order total.
 *
 * 2. **Append, never replace.** `appendUnique` merges a newly fetched page into
 *    the accumulated list and drops any id already present. Even with a total
 *    order, rows can shift when a task is edited between page loads, so a naive
 *    append would duplicate an id; this makes the merge idempotent.
 *
 * Nothing here performs I/O and nothing here is Supabase-specific, so the rules
 * are directly testable without a database or a DOM.
 */

/** Default number of rows fetched per page. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * The column appended as a final sort key to every paged query.
 *
 * `id` is the primary key and therefore unique, which is what makes each
 * ordering total. Appending it never changes the relative order of rows that
 * already differ on the primary sort column, so existing UI semantics are
 * preserved exactly.
 */
export const REQUIRED_TIEBREAKER = "id";

/** A single page of rows plus the exact total for the whole query. */
export interface Page<T> {
  rows: T[];
  /** Exact total matching rows, counted in Postgres, not derived from `rows`. */
  total: number;
}

/** Only the id is needed to merge, so any keyed shape is accepted. */
interface Identifiable {
  id: string;
}

/** Anything with a `rows`/`total` shape, e.g. an infinite-query page. */
interface Paged<T> {
  rows: T[];
  /**
   * `null` means "could not be determined". It is deliberately distinct from
   * `0`: a service that fails to obtain a count may report 0, and treating that
   * as a real total would conclude the list is finished while rows are present.
   */
  total: number | null;
}

/**
 * Merges a freshly fetched page into the rows already loaded.
 *
 * Ids already present are skipped, so re-fetching a page (a refetch after an
 * invalidation, a retry, or a row that shifted across the boundary) can never
 * produce a duplicate card. Order is preserved: existing rows keep their
 * position and genuinely new rows are appended in the order the database
 * returned them.
 */
export function appendUnique<T extends Identifiable>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;

  const seen = new Set(existing.map((row) => row.id));
  const merged = [...existing];

  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }

  return merged;
}

/**
 * Whether another page exists after `loaded` rows have been accumulated.
 *
 * `total` is authoritative, so this is exact even when a page came back short
 * (for instance because a row was deleted mid-scroll). Passing `null` for
 * `total` means "unknown", which is treated as "maybe more" so a query that
 * could not count never hides the Load More control.
 */
export function hasMorePages(loaded: number, total: number | null): boolean {
  if (total === null) return true;
  return loaded < total;
}

/**
 * Whether a fetched page means there is nothing left to load.
 *
 * An empty page is the only reliable end-of-list signal, and it is also the
 * signal used when `total` is unknown, so both cases agree.
 */
export function isLastPage<T>(page: Paged<T>, loadedBefore: number): boolean {
  if (page.rows.length === 0) return true;
  if (page.total !== null && loadedBefore + page.rows.length >= page.total) return true;
  return false;
}

/**
 * Narrows a page size to a usable positive integer.
 *
 * A page size of 0 would make `hasMore` permanently true and silently loop; a
 * negative or `NaN` one reaches the query as an invalid range. Callers pass
 * user- or config-derived values in some places, so this is enforced centrally.
 */
export function normalizePageSize(size: number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 1) return fallback;
  return Math.floor(size);
}
