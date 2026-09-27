import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase", () => ({ supabase: {} }));

import {
  listNotificationsPage,
  listNotifications,
  getUnreadCount,
  NOTIFICATION_PAGE_SIZE,
} from "./notificationService";
import { REQUIRED_TIEBREAKER } from "./pagination";
import { supabase } from "@/services/supabase";
import type { Notification } from "@/types";

interface Recorder {
  order: { column: string; ascending: boolean }[];
  range: { from: number; to: number } | null;
  limit: number | null;
  eqs: [string, unknown][];
}

function makeQuery(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const rec: Recorder = { order: [], range: null, limit: null, eqs: [] };
  const builder: Record<string, unknown> = {};

  const terminal = () =>
    Promise.resolve({
      data: response.data ?? [],
      error: response.error ?? null,
      count: response.count ?? null,
    });

  /*
   * A head-only count query is awaited directly off the filter chain, with no
   * `.range()` or `.limit()` in between, so the builder itself has to be
   * thenable. Without this the awaited value is the builder and the count reads
   * as 0.
   */
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => terminal().then(onFulfilled, onRejected) as never;

  builder.select = vi.fn(() => builder);
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

  const from = vi.fn(() => builder);
  (supabase as unknown as { from: unknown }).from = from;
  return rec;
}

const notification = (i: number, isRead = false): Notification => ({
  id: `n${String(i).padStart(4, "0")}`,
  user_id: "u1",
  task_id: null,
  title: `Notification ${i}`,
  message: "message",
  type: "IN_APP",
  is_read: isRead,
  created_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
  read_at: null,
});

beforeEach(() => {
  (supabase as unknown as { from: unknown }).from = vi.fn();
});

describe("listNotificationsPage — ordering", () => {
  it("keeps newest-first ordering and adds an id tiebreaker, also descending", async () => {
    // created_at DESC preserves the existing UI order. Two notifications can
    // share a timestamp when a reminder batch inserts them together, so without
    // the id tiebreaker their relative order is arbitrary and a row can appear
    // on two pages or on none.
    const rec = makeQuery({ data: [], count: 0 });
    await listNotificationsPage();

    expect(rec.order).toEqual([
      { column: "created_at", ascending: false },
      { column: REQUIRED_TIEBREAKER, ascending: false },
    ]);
  });
});

describe("listNotificationsPage — pages and boundaries", () => {
  it("returns an empty page and zero total for no notifications", async () => {
    makeQuery({ data: [], count: 0 });
    const page = await listNotificationsPage();
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("returns fewer than a page when that is all there is", async () => {
    makeQuery({ data: [notification(1), notification(2)], count: 2 });
    const page = await listNotificationsPage();
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it("returns exactly one full page", async () => {
    const data = Array.from({ length: NOTIFICATION_PAGE_SIZE }, (_, i) => notification(i));
    makeQuery({ data, count: 60 });
    const page = await listNotificationsPage();

    expect(page.rows).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(page.total).toBe(60);
  });

  it("asks for the first page range by default", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listNotificationsPage();
    expect(rec.range).toEqual({ from: 0, to: NOTIFICATION_PAGE_SIZE - 1 });
  });

describe("listNotifications — first page only", () => {
  it("returns just the rows of the first page", async () => {
    const data = [notification(1), notification(2)];
    makeQuery({ data, count: 340 });
    const rows = await listNotifications();

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("n0001");
  });

  it("returns an empty array when there is nothing", async () => {
    makeQuery({ data: [], count: 0 });
    await expect(listNotifications()).resolves.toEqual([]);
  });
});

describe("unread behaviour is independent of pagination", () => {
  it("uses a count over the whole table", async () => {
    // This is what makes the badge correct no matter how many pages are loaded.
    makeQuery({ data: null, count: 12 });
    const count = await getUnreadCount();

    expect(count).toBe(12);
  });

  it("does not read unread state from the loaded pages", async () => {
    const rec = makeQuery({ data: null, count: 5 });
    await getUnreadCount();

    // No range and no row limit: the count is a separate aggregate over every
    // unread row, not a tally of what happens to be fetched.
    expect(rec.range).toBeNull();
    expect(rec.limit).toBeNull();
    expect(rec.eqs).toEqual([["is_read", false]]);
  });

  it("preserves the read flag on rows it does return", async () => {
    makeQuery({ data: [notification(1, true), notification(2, false)], count: 2 });
    const rows = await listNotifications();

    expect(rows[0].is_read).toBe(true);
    expect(rows[1].is_read).toBe(false);
  });

  it("reports zero rather than a negative or missing count", async () => {
    makeQuery({ data: null, count: null });
    await expect(getUnreadCount()).resolves.toBe(0);
  });
});

describe("notifications — RLS is not bypassed", () => {
  it("adds no user_id predicate of its own", async () => {
    // The policy scopes rows to the caller; an explicit filter here would only
    // duplicate it and could later drift from it.
    const rec = makeQuery({ data: [], count: 0 });
    await listNotificationsPage();
    expect(rec.eqs.some(([column]) => column === "user_id")).toBe(false);
  });
});

  it("asks for a second page range", async () => {
    const rec = makeQuery({ data: [], count: 60 });
    await listNotificationsPage({ offset: NOTIFICATION_PAGE_SIZE });
    expect(rec.range).toEqual({
      from: NOTIFICATION_PAGE_SIZE,
      to: NOTIFICATION_PAGE_SIZE * 2 - 1,
    });
  });

  it("clamps a negative offset", async () => {
    const rec = makeQuery({ data: [], count: 0 });
    await listNotificationsPage({ offset: -5 });
    expect(rec.range?.from).toBe(0);
  });

  it("surfaces the exact total so the panel can say how many exist", async () => {
    // The old .limit(100) reported nothing about the rest.
    makeQuery({ data: [notification(1)], count: 340 });
    const page = await listNotificationsPage();
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(340);
  });
});
