/**
 * Task-list view semantics and count wording.
 *
 * Two related problems are solved here.
 *
 * 1. The six task-list filter buttons looked like tabs but were plain buttons
 *    with no exposed selected state, so a screen-reader user tabbing through
 *    them heard six identical labels and no indication of which view was
 *    showing. `aria-pressed` states the selection without imposing a full
 *    tablist/tab/tabpanel architecture, which this UI does not have: these
 *    buttons do not move focus, do not own arrow-key navigation, and all
 *    render into the same list rather than separate panels. A labelled group of
 *    toggle buttons is the accurate description, and it matches the pattern
 *    already used by the theme and timezone pickers in Settings.
 *
 * 2. The list showed two counts in the same "Showing X of Y" shape — one
 *    comparing matches to loaded rows, one comparing loaded rows to the server
 *    total. They read as a duplicated message describing the same thing, which
 *    is actively misleading: the filtered number only covers the rows loaded so
 *    far, so presenting both invites reading it as a complete result count.
 *    The match line now says what it means ("N matching tasks") and only appears
 *    when a filter is actually narrowing the list, leaving the pagination line
 *    as the single authoritative "Showing X of Y tasks".
 *
 * The values here are testability. The project has no DOM test environment, so
 * `aria-pressed` and the rendered sentences cannot be observed by mounting the
 * page; deriving them from pure functions makes the wording rules — especially
 * the ones that decide *when* a line is hidden — directly testable.
 */

/** The task-list filter tabs, in render order. */
export type TaskFilterTabKey =
  | "all"
  | "today"
  | "upcoming"
  | "completed"
  | "overdue"
  | "shared";

/** Accessible name for the group that wraps the six filter buttons. */
export const TASK_FILTER_GROUP_LABEL = "Filter tasks by view";

/**
 * The attributes a filter button must carry to expose its selected state.
 *
 * Returns the ARIA attributes only. The visible styling is chosen by the same
 * `tab === t.key` comparison the component already makes, and is untouched.
 */
export function getTaskFilterTabAria(
  tabKey: TaskFilterTabKey,
  activeTab: TaskFilterTabKey
): { "aria-pressed": boolean } {
  return { "aria-pressed": tabKey === activeTab };
}

/** The narrowing controls that make the match count meaningful. */
export interface TaskFilterState {
  tab: TaskFilterTabKey;
  search: string;
  status: string;
  priority: string;
  category: string;
  tag: string;
}

/**
 * Whether anything is actually narrowing the list.
 *
 * "All Tasks" is the unfiltered baseline, and a whitespace-only search box is
 * not a filter. When nothing is active the match count is just the loaded count
 * again, so the caller hides the line instead of printing it twice.
 */
export function isTaskFilterActive(state: TaskFilterState): boolean {
  return (
    state.tab !== "all" ||
    state.search.trim() !== "" ||
    state.status !== "" ||
    state.priority !== "" ||
    state.category !== "" ||
    state.tag !== ""
  );
}

export interface FilterMatchMessageInput {
  /** Rows matching the current filter, across everything loaded so far. */
  matchCount: number;
  /** True when a filter or search is narrowing the list. */
  isFiltered: boolean;
  /** True when further pages remain unloaded. */
  hasMore: boolean;
}

/**
 * The match-count line shown above the list, or `null` when it should not be
 * rendered at all.
 *
 * Returns `null` with no filter active: the pagination line already reports the
 * total, and a second identical number would read as a contradiction rather
 * than a confirmation.
 *
 * "so far" is appended while pages remain unloaded, because the filters run
 * client-side over the accumulated rows only — the true number of matches is
 * not yet knowable, and the pagination sentence in this page is careful not to
 * imply otherwise.
 */
export function getFilterMatchMessage({
  matchCount,
  isFiltered,
  hasMore,
}: FilterMatchMessageInput): string | null {
  if (!isFiltered) return null;
  const partial = hasMore ? " loaded so far" : "";
  if (matchCount === 0) return `No matching tasks${partial}`;
  const noun = matchCount === 1 ? "matching task" : "matching tasks";
  return `${matchCount.toLocaleString()} ${noun}${partial}`;
}

export interface LoadedCountMessageInput {
  /** Rows accumulated so far. */
  loadedCount: number;
  /** Exact server-side total, or null when it could not be determined. */
  total: number | null;
  /** True when further pages remain unloaded. */
  hasMore: boolean;
}

/**
 * The pagination line, which stays the authoritative account-wide count.
 *
 * Returns `null` before anything is loaded, or while the total is still
 * unknown, so the page never prints a count it cannot stand behind.
 */
export function getLoadedCountMessage({
  loadedCount,
  total,
  hasMore,
}: LoadedCountMessageInput): string | null {
  if (loadedCount <= 0 || total === null) return null;
  if (hasMore) {
    return `Showing ${loadedCount.toLocaleString()} of ${total.toLocaleString()} tasks`;
  }
  return `${loadedCount.toLocaleString()} task${loadedCount === 1 ? "" : "s"}`;
}