import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase", () => ({ supabase: {} }));

import { getTaskTagMapChunk, mergeTagMaps, TAG_MAP_BATCH_SIZE } from "./tagService";
import { supabase } from "@/services/supabase";
import type { Tag } from "@/types";

/*
 * These assert the request the service builds and the map it returns, without a
 * DOM or a database. The Supabase client is stubbed exactly as the other service
 * tests do, so no request leaves the machine.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tag = (n: number): Tag => ({
  id: uuid(9000 + n),
  user_id: "u1",
  name: `tag-${n}`,
  created_at: "2026-01-01T00:00:00.000Z",
});

/** Records the id list of every `.in("task_id", …)` the query performs. */
function stub(rows: unknown[], error: unknown = null) {
  const calls: string[][] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn((_column: string, ids: string[]) => {
    calls.push(ids);
    return Promise.resolve({ data: rows, error });
  });
  (supabase as unknown as { from: unknown }).from = vi.fn(() => chain);
  return { calls };
}

const taskRow = (taskId: string, tagId: number) => ({
  task_id: taskId,
  tag_id: uuid(9000 + tagId),
  tags: tag(tagId),
});

beforeEach(() => {
  (supabase as unknown as { from: unknown }).from = vi.fn();
});

describe("getTaskTagMapChunk — request behaviour", () => {
  it("issues no request for an empty id list", async () => {
    const { calls } = stub([]);
    expect(await getTaskTagMapChunk([])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("issues exactly one request for a single task", async () => {
    const { calls } = stub([taskRow(uuid(1), 1)]);
    await getTaskTagMapChunk([uuid(1)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([uuid(1)]);
  });

  it("issues exactly one request below the batch size", async () => {
    const { calls } = stub([]);
    await getTaskTagMapChunk([uuid(1), uuid(2), uuid(3)]);
    expect(calls).toHaveLength(1);
  });

  it("issues one request at exactly the batch size", async () => {
    // The batch is the caller's responsibility; the service must not split it.
    const ids = Array.from({ length: TAG_MAP_BATCH_SIZE }, (_, i) => uuid(i));
    const { calls } = stub([]);
    await getTaskTagMapChunk(ids);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(TAG_MAP_BATCH_SIZE);
  });

  it("deduplicates ids so a repeated id is sent once", async () => {
    const { calls } = stub([]);
    await getTaskTagMapChunk([uuid(1), uuid(2), uuid(1), uuid(2), uuid(1)]);
    expect(calls[0]).toEqual([uuid(1), uuid(2)]);
  });

  it("propagates an error rather than returning a partial map", async () => {
    stub([], { code: "42501", message: "permission denied for table task_tags" });
    await expect(getTaskTagMapChunk([uuid(1)])).rejects.toThrow();
  });

  it("surfaces an RLS denial as safe copy, not the provider text", async () => {
    stub([], { code: "42501", message: "permission denied for table task_tags" });
    await expect(getTaskTagMapChunk([uuid(1)])).rejects.toThrow(
      "You do not have permission to perform this action."
    );
  });

describe("getTaskTagMapChunk — result correctness", () => {
  it("maps each tag to the task that owns it", async () => {
    stub([taskRow(uuid(1), 1), taskRow(uuid(2), 2)]);
    const map = await getTaskTagMapChunk([uuid(1), uuid(2)]);

    expect(Object.keys(map).sort()).toEqual([uuid(1), uuid(2)].sort());
    expect(map[uuid(1)]).toEqual([tag(1)]);
    expect(map[uuid(2)]).toEqual([tag(2)]);
  });

  it("collects every tag for one task", async () => {
    stub([taskRow(uuid(1), 1), taskRow(uuid(1), 2)]);
    const map = await getTaskTagMapChunk([uuid(1)]);

    expect(map[uuid(1)].map((t) => t.name)).toEqual(["tag-1", "tag-2"]);
  });

  it("omits tasks that have no tags", async () => {
    stub([taskRow(uuid(1), 1)]);
    const map = await getTaskTagMapChunk([uuid(1), uuid(2)]);

    expect(map[uuid(2)]).toBeUndefined();
  });

  it("returns an empty map for an empty response", async () => {
    stub([]);
    expect(await getTaskTagMapChunk([uuid(1)])).toEqual({});
  });

  it("accepts the embedded tag as a one-element array", async () => {
    // Supabase returns the to-one relation as an object or a one-element array
    // depending on inferred schema types; both must work.
    stub([{ task_id: uuid(1), tag_id: uuid(9001), tags: [tag(1)] }]);
    const map = await getTaskTagMapChunk([uuid(1)]);

    expect(map[uuid(1)].map((t) => t.name)).toEqual(["tag-1"]);
  });

  it("skips a row whose embedded tag is null", async () => {
    stub([{ task_id: uuid(1), tag_id: uuid(9001), tags: null }]);
    expect(await getTaskTagMapChunk([uuid(1)])).toEqual({});
  });
});

describe("mergeTagMaps", () => {
  it("merges disjoint batches without loss", () => {
    const merged = mergeTagMaps([{ [uuid(1)]: [tag(1)] }, { [uuid(2)]: [tag(2)] }]);

    expect(merged[uuid(1)]).toEqual([tag(1)]);
    expect(merged[uuid(2)]).toEqual([tag(2)]);
  });

  it("ignores batches that have not loaded yet", () => {
    // Rendered while a later page is still in flight: a missing batch must not
    // blank out the rows that did arrive.
    const merged = mergeTagMaps([{ [uuid(1)]: [tag(1)] }, undefined]);

    expect(merged[uuid(1)]).toEqual([tag(1)]);
  });

  it("returns an empty map for no batches", () => {
    expect(mergeTagMaps([])).toEqual({});
  });

  it("combines tags for a task that appears in more than one batch", () => {
    const merged = mergeTagMaps([{ [uuid(1)]: [tag(1)] }, { [uuid(1)]: [tag(2)] }]);

    expect(merged[uuid(1)].map((t) => t.name)).toEqual(["tag-1", "tag-2"]);
  });

  it("drops empty tag lists so a task with none is absent", () => {
    expect(mergeTagMaps([{ [uuid(1)]: [] }])).toEqual({});
  });
});

});
