import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * Covers the authorization gate in front of task-tag synchronisation.
 *
 * `get_task_access` (migration 015) is the same RPC the rest of the app uses, so
 * this exercises the real contract: a VIEW collaborator must be refused before
 * any tag write is attempted, and an owner/EDIT collaborator must be allowed.
 */
type AccessResult =
  | { ok: true; is_owner: boolean; permission: string | null }
  | { ok: false; reason: string };

let access: AccessResult = { ok: true, is_owner: true, permission: null };
let accessError: { message: string } | null = null;
const writes: string[] = [];
let existingLinks: string[] = [];
let ownTags: string[] = [];

function makeQuery(table: string) {
  const chain: Record<string, unknown> = {};
  // The operation is discovered from whichever terminal method the caller
  // invokes, not from the `from()` call, so writes are recorded accurately.
  let op: "select" | "insert" | "delete" | "update" = "select";

  const noop = () => chain;
  chain.select = vi.fn(noop);
  chain.eq = vi.fn(noop);
  chain.in = vi.fn(noop);
  chain.insert = vi.fn(() => {
    op = "insert";
    writes.push(`insert:${table}`);
    return chain;
  });
  chain.delete = vi.fn(() => {
    op = "delete";
    writes.push(`delete:${table}`);
    return chain;
  });
  chain.update = vi.fn(() => {
    op = "update";
    writes.push(`update:${table}`);
    return chain;
  });

  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (op === "select") {
      if (table === "tags") {
        result = { data: ownTags.map((id) => ({ id })), error: null };
      } else if (table === "task_tags") {
        result = { data: existingLinks.map((tag_id) => ({ tag_id })), error: null };
      } else if (table === "tasks") {
        result = { data: { id: "task-1" }, error: null };
      }
    }
    return Promise.resolve(result).then(resolve, reject);
  };

  // `updateTask` awaits `.update(...).eq(...).select("*").single()`.
  chain.single = vi.fn(() => Promise.resolve({ data: { id: "task-1" }, error: null }));
  return chain;
}

vi.mock("@/services/supabase", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    rpc: () => {
      const chain: Record<string, unknown> = {};
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: access, error: accessError }).then(resolve, reject);
      return chain;
    },
  },
}));

import { updateTask } from "./taskService";

beforeEach(() => {
  access = { ok: true, is_owner: true, permission: null };
  accessError = null;
  writes.length = 0;
  existingLinks = [];
  ownTags = ["tag-1"];
});

describe("task tag synchronisation authorization", () => {
  it("allows the owner to change tags", async () => {
    await updateTask("task-1", { title: "t", tagIds: ["tag-1"] });
    expect(writes.filter((w) => w.startsWith("insert"))).toContain("insert:task_tags");
  });

  it("allows an EDIT collaborator to change tags", async () => {
    access = { ok: true, is_owner: false, permission: "EDIT" };
    await updateTask("task-1", { title: "t", tagIds: ["tag-1"] });
    expect(writes.filter((w) => w.startsWith("insert"))).toContain("insert:task_tags");
  });

  it("denies a VIEW collaborator before performing any write", async () => {
    // Regression: permission was previously only discovered when RLS rejected a
    // write, which could happen after other tags had already been attached.
    access = { ok: true, is_owner: false, permission: "VIEW" };
    await expect(updateTask("task-1", { title: "t", tagIds: ["tag-1"] })).rejects.toThrow(
      "You do not have permission to change this task."
    );
    expect(writes).toEqual([]);
  });

  it("denies a user with no relationship to the task before any write", async () => {
    access = { ok: false, reason: "not_permitted" };
    await expect(updateTask("task-1", { title: "t", tagIds: ["tag-1"] })).rejects.toThrow(
      "You do not have permission to change this task."
    );
    expect(writes).toEqual([]);
  });

  it("rejects foreign tag ids rather than attaching them", async () => {
    // Only tag-1 is owned by the caller. A foreign id is invisible to the
    // RLS-scoped `tags` select, so it is dropped and must never be written.
    ownTags = ["tag-1"];
    existingLinks = ["tag-1"];
    await updateTask("task-1", { title: "t", tagIds: ["tag-1", "someone-elses-tag"] });
    // tag-1 is already linked and the foreign tag is filtered out.
    expect(writes.filter((w) => w.startsWith("insert"))).toEqual([]);
    expect(writes.filter((w) => w.startsWith("delete"))).toEqual([]);
  });

  it("attaches a newly selected owned tag", async () => {
    ownTags = ["tag-new"];
    existingLinks = [];
    await updateTask("task-1", { title: "t", tagIds: ["tag-new"] });
    expect(writes).toContain("insert:task_tags");
  });

  it("detaches tags that are no longer selected", async () => {
    existingLinks = ["tag-old"];
    ownTags = [];
    await updateTask("task-1", { title: "t", tagIds: [] });
    expect(writes).toContain("delete:task_tags");
  });

  it("does not touch tag rows when no tagIds are supplied", async () => {
    await updateTask("task-1", { title: "just a title" });
    // The task row itself is updated; no tag link is read or written.
    expect(writes).toContain("update:tasks");
    expect(writes.filter((w) => w.includes("task_tags"))).toEqual([]);
  });

  it("surfaces a failure from the access check instead of proceeding", async () => {
    accessError = { message: "boom" };
    await expect(updateTask("task-1", { title: "t", tagIds: ["tag-1"] })).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

