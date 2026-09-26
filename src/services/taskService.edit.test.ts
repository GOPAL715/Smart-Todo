import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * The tag relation is loaded through a two-call chain: the task row, then the
 * embedded `task_tags -> tags` read. Each test configures both independently so
 * one can fail while the other succeeds, which is the exact condition that made
 * the data-loss bug possible.
 */
type Call = { table: string; op: string };

const calls: Call[] = [];
let taskRow: Record<string, unknown> | null = null;
let taskError: { message: string } | null = null;
let tagError: { message: string } | null = null;
let subtaskError: { message: string } | null = null;
let tags: Record<string, unknown>[] = [];
let subtasks: Record<string, unknown>[] = [];

function makeQuery(table: string, op: string) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: taskRow, error: taskError })
  );
  chain.single = vi.fn(() => Promise.resolve({ data: taskRow, error: taskError }));
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(
      op === "insert" || op === "update" || op === "delete"
        ? { data: null, error: null }
        : table === "task_tags"
        ? { data: tagError ? null : [{ tag_id: "t1", tags }], error: tagError }
        : table === "subtasks"
        ? { data: subtaskError ? null : subtasks, error: subtaskError }
        : { data: null, error: null }
    ).then(resolve, reject);
  calls.push({ table, op });
  return chain;
}

vi.mock("@/services/supabase", () => ({
  supabase: {
    from: (table: string) => makeQuery(table, "select"),
  },
}));

import { getTaskForEdit } from "./taskService";
import type { Task } from "@/types";

const baseTask = {
  id: "task-1",
  user_id: "user-1",
  title: "Original title",
  task_date: "2026-01-16",
  start_time: "09:00",
  end_time: "10:00",
  start_datetime: "2026-01-16T03:30:00.000Z",
  end_datetime: "2026-01-16T04:30:00.000Z",
  duration_minutes: 60,
  reminder_offsets: [10],
  status: "PENDING",
  priority: "MEDIUM",
} as unknown as Task;

beforeEach(() => {
  calls.length = 0;
  taskRow = { ...baseTask };
  taskError = null;
  tagError = null;
  subtaskError = null;
  tags = [{ id: "tag-1", name: "work" }];
  subtasks = [{ id: "sub-1" }];
});

describe("getTaskForEdit tag data-loss protection", () => {
  it("reports tags as loaded when the request succeeds", async () => {
    const result = await getTaskForEdit("task-1");
    expect(result.tagsLoaded).toBe(true);
    expect(result.subtasksLoaded).toBe(true);
    expect(result.task?.tags).toHaveLength(1);
  });

  it("distinguishes a genuine zero-tag task from a failed tag load", async () => {
    // Case 1: the request succeeded and the task really has no tags.
    tags = [];
    const loaded = await getTaskForEdit("task-1");
    expect(loaded.tagsLoaded).toBe(true);
    expect(loaded.task?.tags).toEqual([]);

    // Case 2: the request failed. This must NOT look like case 1.
    tagError = { message: "network down" };
    const failed = await getTaskForEdit("task-1");
    expect(failed.tagsLoaded).toBe(false);
  });

  it("flags a failed tag load so submission can be blocked", async () => {
    tagError = { message: "Failed to fetch" };
    const result = await getTaskForEdit("task-1");

    // The form refuses to save unless this is true, which is what prevents an
    // empty tag list from being written back over the task's real tags.
    expect(result.tagsLoaded).toBe(false);
    expect(result.task).not.toBeNull();
  });

  it("still loads the task row when only the tag request fails", async () => {
    tagError = { message: "Failed to fetch" };
    const result = await getTaskForEdit("task-1");

    // Other fields remain editable-friendly rather than being lost.
    expect(result.task?.title).toBe("Original title");
    expect(result.task?.task_date).toBe("2026-01-16");
  });

  it("reports a subtask failure independently of tags", async () => {
    subtaskError = { message: "Failed to fetch" };
    const result = await getTaskForEdit("task-1");

    expect(result.subtasksLoaded).toBe(false);
    expect(result.tagsLoaded).toBe(true);
  });

  it("treats a missing task as loaded, so the form shows not-found not a tag error", async () => {
    taskRow = null;
    const result = await getTaskForEdit("task-1");
    expect(result.task).toBeNull();
    expect(result.tagsLoaded).toBe(true);
  });

  it("rejects when the task row itself cannot be read", async () => {
    taskError = { message: "permission denied" };
    await expect(getTaskForEdit("task-1")).rejects.toThrow();
  });
});
