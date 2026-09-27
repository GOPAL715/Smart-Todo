import { describe, expect, it } from "vitest";
import {
  TASK_FILTER_GROUP_LABEL,
  getFilterMatchMessage,
  getLoadedCountMessage,
  getTaskFilterTabAria,
  isTaskFilterActive,
  type TaskFilterState,
} from "./taskListView";

const NO_FILTER: TaskFilterState = {
  tab: "all",
  search: "",
  status: "",
  priority: "",
  category: "",
  tag: "",
};

describe("getTaskFilterTabAria", () => {
  it("marks only the active tab as pressed", () => {
    expect(getTaskFilterTabAria("today", "today")).toEqual({ "aria-pressed": true });
    for (const key of ["all", "upcoming", "completed", "overdue", "shared"] as const) {
      expect(getTaskFilterTabAria(key, "today")).toEqual({ "aria-pressed": false });
    }
  });

  it("moves the pressed state when the active tab changes", () => {
    expect(getTaskFilterTabAria("all", "all")["aria-pressed"]).toBe(true);
    expect(getTaskFilterTabAria("all", "overdue")["aria-pressed"]).toBe(false);
    expect(getTaskFilterTabAria("overdue", "overdue")["aria-pressed"]).toBe(true);
  });

  it("returns a real boolean rather than a truthy value", () => {
    // React omits aria-* entirely for undefined and renders `aria-pressed="true"`
    // for the string, so the helper must never hand back a truthy non-boolean.
    expect(typeof getTaskFilterTabAria("all", "all")["aria-pressed"]).toBe("boolean");
    expect(typeof getTaskFilterTabAria("all", "shared")["aria-pressed"]).toBe("boolean");
  });

  it("exposes exactly one pressed tab for every active tab", () => {
    const tabs = ["all", "today", "upcoming", "completed", "overdue", "shared"] as const;
    for (const active of tabs) {
      const pressed = tabs.filter((t) => getTaskFilterTabAria(t, active)["aria-pressed"]);
      expect(pressed).toEqual([active]);
    }
  });

  it("names the group the buttons live in", () => {
    expect(TASK_FILTER_GROUP_LABEL).toBe("Filter tasks by view");
  });
});

describe("isTaskFilterActive", () => {
  it("is false for the unfiltered baseline", () => {
    expect(isTaskFilterActive(NO_FILTER)).toBe(false);
  });

  it("ignores a whitespace-only search box", () => {
    expect(isTaskFilterActive({ ...NO_FILTER, search: "   " })).toBe(false);
  });

  it("is true for a non-baseline tab", () => {
    expect(isTaskFilterActive({ ...NO_FILTER, tab: "overdue" })).toBe(true);
  });

  it("is true for each narrowing control independently", () => {
    expect(isTaskFilterActive({ ...NO_FILTER, search: "report" })).toBe(true);
    expect(isTaskFilterActive({ ...NO_FILTER, status: "PENDING" })).toBe(true);
    expect(isTaskFilterActive({ ...NO_FILTER, priority: "HIGH" })).toBe(true);
    expect(isTaskFilterActive({ ...NO_FILTER, category: "work" })).toBe(true);
    expect(isTaskFilterActive({ ...NO_FILTER, tag: "urgent" })).toBe(true);
  });
});
describe("getFilterMatchMessage", () => {
  it("is hidden when no filter is active, so it cannot contradict the total", () => {
    // With no filter the match count is just the loaded count again. Printing it
    // beside the pagination line is the duplicate this message replaced.
    expect(getFilterMatchMessage({ matchCount: 40, isFiltered: false, hasMore: false })).toBeNull();
    expect(getFilterMatchMessage({ matchCount: 40, isFiltered: false, hasMore: true })).toBeNull();
  });

  it("counts matches when a search is active", () => {
    expect(getFilterMatchMessage({ matchCount: 7, isFiltered: true, hasMore: false })).toBe(
      "7 matching tasks"
    );
  });

  it("uses the singular noun for exactly one match", () => {
    expect(getFilterMatchMessage({ matchCount: 1, isFiltered: true, hasMore: false })).toBe(
      "1 matching task"
    );
  });

  it("reads naturally at zero matches", () => {
    expect(getFilterMatchMessage({ matchCount: 0, isFiltered: true, hasMore: false })).toBe(
      "No matching tasks"
    );
  });

  it("flags a partial count while more pages are unloaded", () => {
    // Filters run client-side over loaded rows, so the true match total is not
    // yet knowable and must not be presented as final.
    expect(getFilterMatchMessage({ matchCount: 3, isFiltered: true, hasMore: true })).toBe(
      "3 matching tasks loaded so far"
    );
    expect(getFilterMatchMessage({ matchCount: 0, isFiltered: true, hasMore: true })).toBe(
      "No matching tasks loaded so far"
    );
  });

  it("never produces a second 'Showing X of Y' sentence", () => {
    for (const count of [0, 1, 2, 999]) {
      for (const hasMore of [true, false]) {
        const message = getFilterMatchMessage({ matchCount: count, isFiltered: true, hasMore });
        expect(message).not.toMatch(/Showing .* of /);
      }
    }
  });
});

describe("getLoadedCountMessage", () => {
  it("stays the authoritative loaded-of-total sentence while paging", () => {
    expect(getLoadedCountMessage({ loadedCount: 100, total: 420, hasMore: true })).toBe(
      "Showing 100 of 420 tasks"
    );
  });

  it("simplifies to the plain total once everything is loaded", () => {
    expect(getLoadedCountMessage({ loadedCount: 420, total: 420, hasMore: false })).toBe(
      "420 tasks"
    );
  });

  it("uses the singular noun for a single loaded task", () => {
    expect(getLoadedCountMessage({ loadedCount: 1, total: 1, hasMore: false })).toBe("1 task");
  });

  it("stays silent before anything is loaded", () => {
    expect(getLoadedCountMessage({ loadedCount: 0, total: 0, hasMore: false })).toBeNull();
    expect(getLoadedCountMessage({ loadedCount: 0, total: 50, hasMore: true })).toBeNull();
  });

  it("stays silent while the server total is unknown", () => {
    // Printing a count the server has not confirmed would be a guess.
    expect(getLoadedCountMessage({ loadedCount: 40, total: null, hasMore: true })).toBeNull();
  });

  it("keeps the loaded figure and the total distinguishable when a filter is active", () => {
    const match = getFilterMatchMessage({ matchCount: 3, isFiltered: true, hasMore: true });
    const loaded = getLoadedCountMessage({ loadedCount: 100, total: 420, hasMore: true });
    expect(match).not.toBe(loaded);
    expect(loaded).toBe("Showing 100 of 420 tasks");
  });
});
