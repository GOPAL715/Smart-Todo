import { describe, expect, it } from "vitest";
import {
  appendUnique,
  hasMorePages,
  isLastPage,
  normalizePageSize,
  DEFAULT_PAGE_SIZE,
  REQUIRED_TIEBREAKER,
} from "./pagination";

interface Row {
  id: string;
  n: number;
}

const row = (i: number): Row => ({ id: `r${i}`, n: i });
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("appendUnique", () => {
  it("returns the first page unchanged", () => {
    const first = [row(0), row(1)];
    expect(appendUnique(first, [])).toBe(first);
  });

  it("appends a second page in the order it arrived", () => {
    const result = appendUnique([row(0), row(1)], [row(2), row(3)]);
    expect(ids(result)).toEqual(["r0", "r1", "r2", "r3"]);
  });

  it("does not duplicate a row that shifts across the page boundary", () => {
    // The failure this guards: a task edited between page loads reorders, so its
    // id appears in both responses and a naive concat renders two cards.
    const result = appendUnique([row(0), row(1)], [row(1), row(2)]);
    expect(ids(result)).toEqual(["r0", "r1", "r2"]);
  });

  it("is idempotent when the same page is fetched twice", () => {
    const first = [row(0), row(1)];
    const twice = appendUnique(appendUnique(first, [row(2)]), [row(2)]);
    expect(ids(twice)).toEqual(["r0", "r1", "r2"]);
  });

  it("keeps the existing copy and its position for a repeated id", () => {
    const first = [{ id: "r1", n: 1 }];
    const result = appendUnique(first, [{ id: "r1", n: 999 }]);
    expect(result[0].n).toBe(1);
    expect(result).toHaveLength(1);
  });

  it("skips no rows across three pages", () => {
    const p1 = [row(0), row(1), row(2)];
    const p2 = [row(3), row(4), row(5)];
    const p3 = [row(6)];
    const all = appendUnique(appendUnique(appendUnique([], p1), p2), p3);
    expect(ids(all)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(new Set(ids(all)).size).toBe(7);
  });

  it("tolerates a wholly repeated page (a retry)", () => {
    const first = [row(0), row(1)];
    expect(ids(appendUnique(first, first))).toEqual(["r0", "r1"]);
  });

  it("does not mutate the input array", () => {
    const first = [row(0)];
    const before = ids(first);
    appendUnique(first, [row(1)]);
    expect(ids(first)).toEqual(before);
  });
});

describe("hasMorePages", () => {
  it("is false when everything is loaded", () => {
    expect(hasMorePages(50, 50)).toBe(false);
  });

  it("is true while rows remain", () => {
    expect(hasMorePages(50, 1240)).toBe(true);
  });

  it("is true for an exact page boundary with more behind it", () => {
    expect(hasMorePages(100, 101)).toBe(true);
  });

  it("is false at an exact page boundary that is the whole set", () => {
    expect(hasMorePages(100, 100)).toBe(false);
  });

  it("assumes more may exist when the total is unknown", () => {
    // A count that failed must not silently hide the Load more control.
    expect(hasMorePages(50, null)).toBe(true);
  });

  it("is false for an empty result with a zero total", () => {
    expect(hasMorePages(0, 0)).toBe(false);
  });
});

describe("isLastPage", () => {
  it("is true for an empty page", () => {
    expect(isLastPage({ rows: [], total: 1240 }, 50)).toBe(true);
  });

  it("is true once the accumulated rows reach the total", () => {
    expect(isLastPage({ rows: [row(0), row(1)], total: 52 }, 50)).toBe(true);
  });

  it("is false for a full page with more to come", () => {
    expect(isLastPage({ rows: [row(0), row(1)], total: 1240 }, 50)).toBe(false);
  });

  it("is false for a partial page when the total is unknown", () => {
    // `null` is the "count unavailable" signal. It must not be read as 0, or a
    // short page would be mistaken for the end of the list.
    expect(isLastPage({ rows: [row(0)], total: null }, 50)).toBe(false);
  });

  it("treats a zero total with rows present as a final page", () => {
    // A service that reports 0 while returning rows has an inconsistent count;
    // the rows themselves are the better evidence, so this is accepted as the
    // end rather than inviting an endless sequence of empty pages.
    expect(isLastPage({ rows: [row(0)], total: 0 }, 0)).toBe(true);
  });
});

describe("normalizePageSize", () => {
  it("keeps a valid size", () => {
    expect(normalizePageSize(25)).toBe(25);
  });

  it("truncates a fractional size", () => {
    expect(normalizePageSize(10.9)).toBe(10);
  });

  it("falls back for zero, negative and NaN", () => {
    expect(normalizePageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("falls back for undefined and a non-finite value", () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(Infinity)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("honours a caller-supplied fallback", () => {
    expect(normalizePageSize(0, 100)).toBe(100);
  });
});

describe("REQUIRED_TIEBREAKER", () => {
  it("is the unique primary key", () => {
    // Every paged query appends this as its final sort key. It must be a
    // column whose values are unique, which is what makes offset pagination
    // return a stable total order.
    expect(REQUIRED_TIEBREAKER).toBe("id");
  });
});
