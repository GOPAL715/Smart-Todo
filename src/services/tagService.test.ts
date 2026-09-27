import { describe, it, expect } from "vitest";
import { chunkIds, TAG_MAP_BATCH_SIZE } from "./tagService";
import { queryKeys } from "./queryKeys";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("chunkIds", () => {
  it("returns no chunks for an empty list", () => {
    expect(chunkIds([])).toEqual([]);
  });

  it("keeps a small list in a single batch", () => {
    const ids = Array.from({ length: 5 }, (_, i) => uuid(i));
    expect(chunkIds(ids)).toEqual([ids]);
  });

  it("splits at the batch boundary into whole batches", () => {
    const ids = Array.from({ length: TAG_MAP_BATCH_SIZE * 2 }, (_, i) => uuid(i));
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(TAG_MAP_BATCH_SIZE);
    expect(chunks[1]).toHaveLength(TAG_MAP_BATCH_SIZE);
  });

  it("splits an exact multiple without a trailing empty chunk", () => {
    const ids = Array.from({ length: TAG_MAP_BATCH_SIZE * 3 }, (_, i) => uuid(i));
    expect(chunkIds(ids)).toHaveLength(3);
  });

  it("keeps a remainder chunk smaller than the batch size", () => {
    const ids = Array.from({ length: TAG_MAP_BATCH_SIZE + 7 }, (_, i) => uuid(i));
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toHaveLength(7);
  });

  it("bounds every batch to the batch size regardless of input size", () => {
    const ids = Array.from({ length: 2500 }, (_, i) => uuid(i));
    for (const chunk of chunkIds(ids)) {
      expect(chunk.length).toBeLessThanOrEqual(TAG_MAP_BATCH_SIZE);
    }
  });

  it("preserves order and loses no ids", () => {
    const ids = Array.from({ length: 450 }, (_, i) => uuid(i));
    expect(chunkIds(ids).flat()).toEqual(ids);
  });

  it("honours a custom batch size", () => {
    const ids = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)];
    expect(chunkIds(ids, 2)).toEqual([ids.slice(0, 2), ids.slice(2, 4), ids.slice(4)]);
  });
});

describe("queryKeys.taskTagMapChunk", () => {
  it("is stable for the same ids in a different order", () => {
    const a = queryKeys.taskTagMapChunk("user-1", [uuid(1), uuid(2), uuid(3)]);
    const b = queryKeys.taskTagMapChunk("user-1", [uuid(3), uuid(1), uuid(2)]);
    expect(a).toEqual(b);
  });

  it("produces the same key across repeated renders", () => {
    const ids = Array.from({ length: 20 }, (_, i) => uuid(i));
    expect(queryKeys.taskTagMapChunk("user-1", ids)).toEqual(queryKeys.taskTagMapChunk("user-1", ids));
  });

  it("differs when the id set differs", () => {
    const base = [uuid(1), uuid(2)];
    expect(queryKeys.taskTagMapChunk("user-1", base)).not.toEqual(
      queryKeys.taskTagMapChunk("user-1", [...base, uuid(3)])
    );
  });

  it("is scoped per user so accounts cannot share a cache entry", () => {
    const ids = [uuid(1)];
    expect(queryKeys.taskTagMapChunk("user-1", ids)).not.toEqual(queryKeys.taskTagMapChunk("user-2", ids));
  });

  it("differs by set size even when the hash could collide", () => {
    // Guards the length prefix that disambiguates same-hash, different-size sets.
    expect(queryKeys.taskTagMapChunk("u", [uuid(1)])).not.toEqual(queryKeys.taskTagMapChunk("u", [uuid(1), uuid(2)]));
  });

  it("keeps an earlier page's batch cached when a later page is appended", () => {
    // The property this phase exists for: with a whole-set key, adding ids 3-5
    // produced a new key and re-sent ids 1-2. With per-batch keys the first page
    // keeps its entry and only the appended batch is new.
    const pageOne = queryKeys.taskTagMapChunk("u", [uuid(1), uuid(2)]);
    const pageOneLater = queryKeys.taskTagMapChunk("u", [uuid(1), uuid(2)]);
    const pageTwo = queryKeys.taskTagMapChunk("u", [uuid(3), uuid(4)]);

    expect(pageOneLater).toEqual(pageOne);
    expect(pageTwo).not.toEqual(pageOne);
  });

  it("shares a root that a tag mutation can invalidate wholesale", () => {
    // Both the per-batch keys live under one root, so invalidating the root
    // clears every loaded batch rather than one of them.
    expect(queryKeys.taskTagMapChunk("u", [uuid(1)])[0]).toEqual(queryKeys.taskTagMapRoot()[0]);
    expect(queryKeys.taskTagMapChunk("u", [uuid(2)])[0]).toEqual(queryKeys.taskTagMapRoot()[0]);
  });
});
