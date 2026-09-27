import { useCallback, useMemo, useRef, useState } from "react";
import {
  appendUnique,
  hasMorePages,
  isLastPage,
  normalizePageSize,
  type Page,
} from "@/services/pagination";

/**
 * Accumulates pages of a large collection for a "Load more" UI.
 *
 * This is intentionally a small local hook rather than a switch to
 * `useInfiniteQuery`, for two reasons. First, it keeps the existing queries
 * ordinary `useQuery` calls, so every existing `invalidateQueries` call site
 * keeps working untouched. Second, and more importantly, the accumulated rows
 * are a *working set*: the task list filters, searches, sorts and ranks them in
 * memory over everything loaded so far, which is the behaviour this phase is
 * required to preserve. An infinite-query page cache would need to be flattened
 * into exactly this shape anyway.
 *
 * State is intentionally duplicated-safe: `appendUnique` is applied on every
 * fetch, so a refetch, retry, or a row that shifted across the page boundary
 * cannot produce a duplicate.
 */
export interface PagedCollection<T extends { id: string }> {
  /** Every row loaded so far, in the order the database returned them. */
  rows: T[];
  /** Exact total for the whole query, or null when it could not be determined. */
  total: number | null;
  /** True while the first page is in flight. */
  isLoading: boolean;
  /** True while a subsequent page is in flight. */
  isLoadingMore: boolean;
  /** True when at least one more page is believed to exist. */
  hasMore: boolean;
  /** Set when the most recent attempt failed. */
  error: string | null;
  /** Fetches page 0, replacing the working set. */
  loadFirstPage: () => Promise<void>;
  /** Appends the next page. No-op when already loading or nothing remains. */
  loadMore: () => Promise<void>;
  /**
   * Replaces the working set with the first page, e.g. after a mutation
   * invalidated the underlying query. Safe to call while pages are loaded.
   */
  reset: () => void;
}

export interface UsePagedCollectionOptions<T extends { id: string }> {
  /** Fetches one page. `offset` is 0 for the first page. */
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>;
  pageSize: number;
  /** Reads a user-safe message from an unknown error. */
  onError?: (error: unknown) => string;
}

const DEFAULT_ERROR_MESSAGE = "Could not load more items. Please try again.";

export function usePagedCollection<T extends { id: string }>(
  options: UsePagedCollectionOptions<T>
): PagedCollection<T> {
  const { fetchPage, pageSize, onError } = options;
  const limit = useMemo(() => normalizePageSize(pageSize), [pageSize]);

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * How many rows are actually held. Kept in a ref so `loadMore` can read the
   * next offset synchronously without reading state, and so the two stay in step
   * even if a render is batched between an append and the next click.
   */
  const loadedCountRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchPage(0, limit);
      const merged = appendUnique([], page.rows);
      loadedCountRef.current = merged.length;
      setRows(merged);
      setTotal(page.total);
    } catch (err) {
      setError(onError ? onError(err) : DEFAULT_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, limit, onError]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      /*
       * The offset is read from a ref rather than from state, because a
       * setState updater must stay pure and this is a plain read. The ref is
       * updated on every successful append, so the offset always reflects the
       * number of rows actually held — which is what makes a short page advance
       * correctly instead of skipping rows.
       */
      const offset = loadedCountRef.current;
      const page = await fetchPage(offset, limit);
      setRows((current) => {
        const merged = appendUnique(current, page.rows);
        loadedCountRef.current = merged.length;
        return merged;
      });
      setTotal((current) => {
        if (isLastPage(page, offset)) return current;
        return page.total;
      });
    } catch (err) {
      setError(onError ? onError(err) : DEFAULT_ERROR_MESSAGE);
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchPage, limit, onError, isLoadingMore]);

  const reset = useCallback(() => {
    loadedCountRef.current = 0;
    setRows([]);
    setTotal(null);
    setError(null);
  }, []);

  const hasMore = rows.length > 0 && hasMorePages(rows.length, total);

  return {
    rows,
    total,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadFirstPage,
    loadMore,
    reset,
  };
}
