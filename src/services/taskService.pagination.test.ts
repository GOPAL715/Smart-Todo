import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase", () => ({ supabase: {} }));

import {
  listTasksPage,
  getOverdueTasksPage,
  getUpcomingTasks,
  TASK_PAGE_SIZE,
  OVERDUE_DISPLAY_LIMIT,
  UPCOMING_PREVIEW_LIMIT,
} from "./taskService";
import { REQUIRED_TIEBREAKER } from "./pagination";
import { supabase } from "@/services/supabase";

/*
 * These assert the *query* that is built, not a rendered result. The project
 * has no DOM test environment, and pagination correctness lives almost entirely
 * in two things a render would not reveal: that the ordering is total, and that
 * the range and count are what PostgREST needs to page correctly.
 */

interface Recorder {
  from: ReturnType<typeof vi.fn>;
  calls: string[];
  order: { column: string; ascending: boolean }[];
  range: { from: number; to: number } | null;
  limit: number | null;
  eqs: [string, unknown][];
  neqs: [string, unknown][];
}

function makeQuery(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const rec: Recorder = {
    from: vi.fn(),
    calls: [],
    order: [],
    range: null,
    limit: null,
    eqs: [],
    neqs: [],
  };

  const builder: Record<string, unknown> = {};
  const terminal = () =>
    Promise.resolve({
      data: response.data ?? [],
      error: response.error ?? null,
      count: response.count ?? null,
    });

  builder.select = vi.fn(() => {
    rec.calls.push("select");
    return builder;
  });
  builder.order = vi.fn((column: string, opts: { ascending: boolean }) => {
    rec.order.push({ column, ascending: opts.ascending });
    return builder;
  });
  builder.range = vi.fn((from: number, to: number) => {
    rec.range = { from, to };
    return terminal();
  });
  builder.limit = vi.fn((n: number) => {
    rec.limit = n;
    return terminal();
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    rec.eqs.push([column, value]);
    return builder;
  });
  builder.neq = vi.fn((column: string, value: unknown) => {
    rec.neqs.push([column, value]);
    return builder;
  });
  builder.gt = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);

  rec.from = vi.fn(() => builder);
  (supabase as unknown as { from: unknown }).from = rec.from;
  return rec;
}

/*
 * Typed structurally rather than importing the service's internal `TaskRow`,
 * which is deliberately not exported: widening the module's public surface for a
 * test would be a worse trade than a local shape that only has to satisfy the
 * mapper's reads.
 */
type TaskRowFixture = Record<string, unknown>;

const taskRow = (i: number): TaskRowFixture =>
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
    priority: "MEDIUM",
    category: null,
    status: "PENDING",
    reminder_offsets: [10],
    recurrence: null,
    recurrence_until: null,
    series_id: null,
    schedule_timezone: "UTC",
    series_timezone_locked: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  }) as unknown as TaskRowFixture;

beforeEach(() => {
  (supabase as unknown as { from: unknown }).from = vi.fn();
});

describe("listTasksPage — deterministic ordering", () => {
  it("orders by start_datetime then id, both ascending", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage();

    expect(rec.order).toEqual([
      { column: "start_datetime", ascending: true },
      { column: REQUIRED_TIEBREAKER, ascending: true },
    ]);
  });

  it("appends the tiebreaker after the primary sort column", async () => {
    // Order matters: an id-first ordering would change the list the user sees,
    // because ties on start_datetime would no longer be ordered by time.
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage();
    expect(rec.order[0].column).toBe("start_datetime");
    expect(rec.order[1].column).toBe(REQUIRED_TIEBREAKER);
  });

  it("requests an exact count so the total is not derived from a page", async () => {
    makeQuery({ data: [], count: 1240 });
    const page = await listTasksPage();
    expect(page.total).toBe(1240);
  });
});

describe("listTasksPage — ranges and boundaries", () => {
  it("returns an empty page and a zero total for no records", async () => {
    makeQuery({ data: [], count: 0 });
    const page = await listTasksPage();
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("asks for the first page range", async () => {
    const rec = makeQuery({ data: [], count: 500 });
    await listTasksPage({ offset: 0, limit: 100 });
    expect(rec.range).toEqual({ from: 0, to: 99 });
  });

  it("asks for a second page range", async () => {
    const rec = makeQuery({ data: [], count: 500 });
    await listTasksPage({ offset: 100, limit: 100 });
    expect(rec.range).toEqual({ from: 100, to: 199 });
  });

  it("defaults to one page size", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage();
    expect(rec.range).toEqual({ from: 0, to: TASK_PAGE_SIZE - 1 });
  });

  it("clamps a negative offset to the first page", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage({ offset: -10, limit: 10 });
    expect(rec.range).toEqual({ from: 0, to: 9 });
  });

  it("maps every row of a full page", async () => {
    makeQuery({ data: [taskRow(1), taskRow(2)], count: 2 });
    const page = await listTasksPage();
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].id).toBe("t0001");
  });

  it("falls back to a zero total when the count is absent", async () => {
    makeQuery({ data: [taskRow(1)], count: null });
    const page = await listTasksPage();
    expect(page.total).toBe(0);
  });
});

describe("listTasksPage — filters are preserved", () => {
  it("passes status, priority and category through to the query", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage({
      filters: { status: "COMPLETED", priority: "HIGH", category: "work" },
    });

    expect(rec.eqs).toEqual([
      ["status", "COMPLETED"],
      ["priority", "HIGH"],
      ["category", "work"],
    ]);
  });

  it("applies no filter clauses when none are given", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage();
    expect(rec.eqs).toEqual([]);
  });

  it("keeps filters combined with paging", async () => {
    const rec = makeQuery({ data: [], count: 40 });
    await listTasksPage({ filters: { status: "PENDING" }, offset: 20, limit: 20 });
    expect(rec.eqs).toEqual([["status", "PENDING"]]);
    expect(rec.range).toEqual({ from: 20, to: 39 });
  });
});

describe("listTasksPage — RLS is not bypassed", () => {
  it("issues no user_id predicate of its own", async () => {
    // An .eq("user_id", ...) here would look like authorization but is not: the
    // policies already scope every row to the caller. Pinning the absence keeps
    // a future change from adding a filter that can disagree with the policy.
    const rec = makeQuery({ data: [], count: 0 });
    await listTasksPage();
    expect(rec.eqs.some(([column]) => column === "user_id")).toBe(false);
  });
});
describe("getOverdueTasksPage", () => {
  it("keeps the existing end_datetime ascending ordering with an id tiebreaker", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await getOverdueTasksPage();

    expect(rec.order).toEqual([
      { column: "end_datetime", ascending: true },
      { column: REQUIRED_TIEBREAKER, ascending: true },
    ]);
  });

  it("still defines overdue as status OVERDUE", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await getOverdueTasksPage();
    expect(rec.eqs).toEqual([["status", "OVERDUE"]]);
  });

  it("returns zero rows and a zero total when nothing is overdue", async () => {
    makeQuery({ data: [], count: 0 });
    const page = await getOverdueTasksPage();
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("returns fewer rows than the total when more exist than are displayed", async () => {
    // The defect this replaces: 100 rows were shown with no hint that 40 more
    // existed, so the panel read as complete.
    makeQuery({ data: [taskRow(1)], count: 140 });
    const page = await getOverdueTasksPage();
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(140);
  });

  it("uses the display limit so the panel keeps its existing size", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await getOverdueTasksPage();
    expect(rec.limit).toBe(OVERDUE_DISPLAY_LIMIT);
  });

  it("reports a total equal to the rows when nothing is hidden", async () => {
    makeQuery({ data: [taskRow(1), taskRow(2)], count: 2 });
    const page = await getOverdueTasksPage();
    expect(page.rows).toHaveLength(page.total);
  });

  it("is not paged by range, since only the first slice is shown", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await getOverdueTasksPage();
    expect(rec.range).toBeNull();
  });
});

describe("getUpcomingTasks — intentional preview limit", () => {
  it("retains a fixed limit as a dashboard preview", async () => {
    // Deliberately not paginated: this is a fixed-size preview panel, and the
    // complete upcoming set is reachable via the task list's Upcoming tab.
    const rec = makeQuery({ data: [], count: null });
    await getUpcomingTasks();
    expect(rec.limit).toBe(UPCOMING_PREVIEW_LIMIT);
  });

  it("orders deterministically so the preview is stable", async () => {
    const rec = makeQuery({ data: [], count: null });
    await getUpcomingTasks();
    expect(rec.order).toEqual([
      { column: "start_datetime", ascending: true },
      { column: REQUIRED_TIEBREAKER, ascending: true },
    ]);
  });

  it("keeps the existing status exclusions", async () => {
    const rec = makeQuery({ data: [], count: null });
    await getUpcomingTasks();
    expect(rec.neqs).toEqual([
      ["status", "CANCELLED"],
      ["status", "COMPLETED"],
    ]);
  });

  it("asks for no exact count, since the preview is not a complete view", async () => {
    const rec = makeQuery({ data: [], count: null });
    await getUpcomingTasks();
    expect(rec.range).toBeNull();
  });
});
