import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

describe("queryKeys user isolation", () => {
  it("gives two users different keys for the same resource", () => {
    expect(queryKeys.taskList(USER_A, "all")).not.toEqual(queryKeys.taskList(USER_B, "all"));
    expect(queryKeys.notificationList(USER_A)).not.toEqual(queryKeys.notificationList(USER_B));
    expect(queryKeys.tags(USER_A)).not.toEqual(queryKeys.tags(USER_B));
    expect(queryKeys.shareOverview(USER_A)).not.toEqual(queryKeys.shareOverview(USER_B));
  });

  it("keeps a per-user task cache entry under the task root for invalidation", () => {
    // Prefix invalidation from `["tasks"]` must still reach user-scoped keys.
    const scoped = queryKeys.taskList(USER_A, "all");
    expect(scoped[0]).toBe("tasks");
    expect(scoped[1]).toBe(USER_A);
  });

  it("keeps notification keys under the notification root", () => {
    expect(queryKeys.notificationList(USER_A)[0]).toBe("notifications");
    expect(queryKeys.notificationUnreadCount(USER_A)[0]).toBe("notifications");
  });

  it("never returns another user's cached data for the same query", () => {
    // The core guarantee: user B's key is absent from user A's cache, so a
    // lookup for B can never resolve to A's rows.
    const client = new QueryClient();
    client.setQueryData(queryKeys.taskList(USER_A, "all"), [{ id: "a-private-task" }]);

    expect(client.getQueryData(queryKeys.taskList(USER_B, "all"))).toBeUndefined();
    expect(client.getQueryData(queryKeys.taskList(USER_A, "all"))).toEqual([
      { id: "a-private-task" },
    ]);
  });

  it("clearing the cache removes the previous user's data entirely", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.taskList(USER_A, "all"), [{ id: "a-private-task" }]);
    client.setQueryData(queryKeys.notificationList(USER_A), [{ id: "a-notification" }]);

    client.clear();

    expect(client.getQueryData(queryKeys.taskList(USER_A, "all"))).toBeUndefined();
    expect(client.getQueryData(queryKeys.notificationList(USER_A))).toBeUndefined();
  });

  it("scopes detail and relation keys per user", () => {
    expect(queryKeys.taskDetail(USER_A, "t1")).not.toEqual(queryKeys.taskDetail(USER_B, "t1"));
    expect(queryKeys.taskTags(USER_A, "t1")).not.toEqual(queryKeys.taskTags(USER_B, "t1"));
    expect(queryKeys.taskSubtasks(USER_A, "t1")).not.toEqual(queryKeys.taskSubtasks(USER_B, "t1"));
    expect(queryKeys.taskReminders(USER_A, "t1")).not.toEqual(queryKeys.taskReminders(USER_B, "t1"));
  });

  it("uses a placeholder scope before a user is known", () => {
    const pending = queryKeys.taskList(undefined, "all");
    expect(pending).toEqual(queryKeys.taskList(undefined, "all"));
    expect(pending).not.toEqual(queryKeys.taskList(USER_A, "all"));
  });
});

describe("queryKeys.taskIdSet", () => {
  it("is stable regardless of id order", () => {
    expect(queryKeys.taskIdSet(["a", "b", "c"])).toBe(queryKeys.taskIdSet(["c", "a", "b"]));
  });

  it("differs for different id sets", () => {
    expect(queryKeys.taskIdSet(["a", "b"])).not.toBe(queryKeys.taskIdSet(["a", "c"]));
  });

  it("distinguishes sets of the same length", () => {
    expect(queryKeys.taskIdSet(["a"])).not.toBe(queryKeys.taskIdSet(["b"]));
  });

  it("keeps the tag-map key stable so it does not churn", () => {
    const client = new QueryClient();
    const ids = ["t1", "t2"];
    client.setQueryData(queryKeys.taskTagMap(USER_A, ids), { t1: [] });

    // Reordering the same ids must not orphan the cache entry.
    expect(client.getQueryData(queryKeys.taskTagMap(USER_A, ["t2", "t1"]))).toEqual({ t1: [] });
    // A different user must not see it.
    expect(client.getQueryData(queryKeys.taskTagMap(USER_B, ids))).toBeUndefined();
  });
});
