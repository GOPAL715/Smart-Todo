import { describe, expect, it } from "vitest";
import { appendUnique, hasMorePages, type Page } from "@/services/pagination";
import { rankTasks } from "@/utils/taskIntelligence";
import type { Task, TaskStatus, TaskPriority } from "@/types";

/*
 * The task list is a client-side working set: tabs, search, filters, sort modes
 * and the Phase 13B smart ranking all run in memory over every row loaded so far.
 *
 * These tests pin that the accumulation step itself cannot change those
 * semantics — a second page must behave exactly like more rows having been in
 * the first response, which is the whole premise of paginating without moving
 * filtering into SQL.
 */

const task = (i: number, over: Partial<Task> = {}): Task =>
  ({
    id: `t${String(i).padStart(4, "0")}`,
    user_id: "u1",
    title: `Task ${i}`,
    description: null,
    task_date: "2026-09-22",
    start_time: "09:00",
    end_time: "10:00",
    start_datetime: "2026-09-22T09:00:00.000Z",
    end_datetime: "2026-09-22T10:00:00.000Z",
    duration_minutes: 60,
    priority: "MEDIUM" as TaskPriority,
    category: null,
    status: "PENDING" as TaskStatus,
    reminder_offsets: [10],
    recurrence: null,
    recurrence_until: null,
    series_id: null,
    schedule_timezone: "UTC",
    series_timezone_locked: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as Task;

const CONTEXT = {
  timezone: "UTC",
  todayStr: "2026-09-22",
  now: new Date("2026-09-22T08:00:00.000Z"),
};

const page = (rows: Task[], total: number): Page<Task> => ({ rows, total });

/** Mirrors the accumulate-then-filter shape the list page performs. */
const accumulate = (...pages: Page<Task>[]) =>
  pages.reduce<Task[]>((acc, p) => appendUnique(acc, p.rows), []);

describe("accumulated pages behave like one contiguous result set", () => {
  it("search matches rows that only arrived on a later page", () => {
    // The bug this rules out: paginating first and filtering per page would
    // make a search miss anything outside the first page.
    const first = page([task(1), task(2)], 4);
    const second = page([task(3), task(4, { title: "Findable invoice" })], 4);
    const all = accumulate(first, second);

    const search = "findable";
    expect(all.filter((t) => t.title.toLowerCase().includes(search))).toHaveLength(1);
  });

  it("applies status filters across pages", () => {
    const first = page([task(1, { status: "PENDING" })], 3);
    const second = page([task(2, { status: "COMPLETED" }), task(3, { status: "COMPLETED" })], 3);
    const all = accumulate(first, second);

    expect(all.filter((t) => t.status === "COMPLETED")).toHaveLength(2);
  });

  it("applies category filters across pages", () => {
    const first = page([task(1, { category: "work" })], 3);
    const second = page([task(2, { category: "home" }), task(3, { category: "work" })], 3);
    const all = accumulate(first, second);

    expect(all.filter((t) => t.category === "work")).toHaveLength(2);
  });

  it("applies the overdue tab filter across pages", () => {
    const first = page([task(1)], 3);
    const second = page([task(2, { status: "OVERDUE" }), task(3, { status: "OVERDUE" })], 3);
    const all = accumulate(first, second);

    expect(all.filter((t) => t.status === "OVERDUE")).toHaveLength(2);
  });

  it("derives the tag and category option lists from everything loaded", () => {
    // These dropdowns are built from the working set, so a task on page 2 must
    // be able to contribute a category.
    const first = page([task(1, { category: "work" })], 2);
    const second = page([task(2, { category: "errands" })], 2);
    const all = accumulate(first, second);

    const categories = Array.from(new Set(all.map((t) => t.category).filter(Boolean)));
    expect(categories.sort()).toEqual(["errands", "work"]);
  });

  it("keeps recurring tasks intact when they appear on a later page", () => {
    const first = page([task(1)], 2);
    const second = page(
      [task(2, { recurrence: "WEEKLY", series_id: "s1", schedule_timezone: "America/New_York" })],
      2
    );
    const all = accumulate(first, second);

    const recurring = all.filter((t) => t.recurrence === "WEEKLY");
    expect(recurring).toHaveLength(1);
    expect(recurring[0].series_id).toBe("s1");
    expect(recurring[0].schedule_timezone).toBe("America/New_York");
  });
});

describe("smart ranking is unchanged by pagination", () => {
  it("ranks the same way over one page and over two", () => {
    const rows = [
      task(1, { status: "PENDING", priority: "LOW" }),
      task(2, { status: "OVERDUE", priority: "URGENT", task_date: "2026-09-20" }),
      task(3, { status: "IN_PROGRESS", priority: "HIGH" }),
      task(4, { status: "PENDING", priority: "MEDIUM" }),
    ];

    const single = rankTasks(rows, CONTEXT).map((t) => t.id);
    const paged = rankTasks(
      accumulate(page(rows.slice(0, 2), 4), page(rows.slice(2), 4)),
      CONTEXT
    ).map((t) => t.id);

    expect(paged).toEqual(single);
  });

  it("does not mutate the accumulated rows while ranking", () => {
    const all = accumulate(page([task(1), task(2)], 2), page([task(3)], 3));
    const before = all.map((t) => t.id);

    rankTasks(all, CONTEXT);

    expect(all.map((t) => t.id)).toEqual(before);
  });

  it("keeps an earlier row ahead of a later one that outranks it", () => {
    // Rank order is the renderer's concern, not the page order's; accumulation
    // must not reorder or discard anything.
    const all = accumulate(page([task(1), task(2)], 3), page([task(3, { status: "OVERDUE" })], 3));
    expect(all.map((t) => t.id)).toEqual(["t0001", "t0002", "t0003"]);
  });
});

describe("page boundary integrity", () => {
  it("produces no duplicates across three pages", () => {
    const all = accumulate(
      page([task(1), task(2), task(3)], 7),
      page([task(4), task(5), task(6)], 7),
      page([task(7)], 7)
    );
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    expect(all).toHaveLength(7);
  });

  it("skips no rows when every page is exactly full", () => {
    // 200 rows in four exact pages of 50: an off-by-one in the range would drop
    // or repeat a row at every boundary.
    const rows = Array.from({ length: 200 }, (_, i) => task(i));
    const size = 50;
    const all = accumulate(
      page(rows.slice(0, size), rows.length),
      page(rows.slice(size, size * 2), rows.length),
      page(rows.slice(size * 2, size * 3), rows.length),
      page(rows.slice(size * 3), rows.length)
    );

    expect(all).toHaveLength(200);
    expect(new Set(all.map((t) => t.id)).size).toBe(200);
  });

  it("re-requests a row deleted between page loads without duplicating it", () => {
    // A row deleted after page 1 shifts the boundary, so page 2 can repeat the
    // last row of page 1. The merge must collapse it.
    const all = accumulate(page([task(1), task(2), task(3)], 5), page([task(3), task(4)], 5));
    expect(all.map((t) => t.id)).toEqual(["t0001", "t0002", "t0003", "t0004"]);
  });

  it("treats an empty trailing page as the end without losing earlier rows", () => {
    const all = accumulate(page([task(1), task(2)], 2), page([], 2));
    expect(all).toHaveLength(2);
    expect(hasMorePages(all.length, 2)).toBe(false);
  });

  it("reports more pages available while a full page is loaded", () => {
    const all = accumulate(page([task(1), task(2)], 5));
    expect(hasMorePages(all.length, 5)).toBe(true);
  });
});

describe("a mutation must be able to refresh the working set", () => {
  /*
   * The rows rendered by the list page and the notification panel live in
   * local paged state, not under the `["tasks", ...]` / `["notifications", ...]`
   * query keys. So an `invalidateQueries` alone no longer updates those screens:
   * a completed, deleted, or just-marked-read row would stay visible while the
   * rest of the app refreshed.
   *
   * This cannot be observed without a DOM, so the contract is pinned here as
   * the shape the refresh must satisfy: reloading the first page is what
   * actually replaces the accumulated rows.
   */
  it("replaces the working set rather than appending when the first page reloads", () => {
    // A completed task disappears from the server, so the reloaded first page
    // is shorter and must not be merged with the stale rows still held.
    const before = accumulate(page([task(1), task(2), task(3)], 3));
    expect(before).toHaveLength(3);

    const reloaded = page([task(1), task(2)], 2);
    const after = appendUnique([], reloaded.rows);

    expect(after).toHaveLength(2);
    expect(after.map((t) => t.id)).toEqual(["t0001", "t0002"]);
  });

  it("keeps a deleted row from surviving a reload", () => {
    const reloaded = page([task(1), task(3)], 2);
    const after = appendUnique([], reloaded.rows);

    expect(after.map((t) => t.id)).not.toContain("t0002");
  });
});
