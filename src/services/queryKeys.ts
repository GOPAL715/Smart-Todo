/**
 * Canonical query keys for authenticated data.
 *
 * Every key that returns user-owned rows is scoped by the signed-in user's id.
 * Two reasons:
 *
 * 1. Isolation. A key like `["tasks"]` is shared across accounts, so on a shared
 *    or kiosk browser the previous user's tasks and notifications can render
 *    from cache before any refetch completes.
 * 2. Correct invalidation. `invalidateQueries({ queryKey: ["tasks"] })` prefix-
 *    matches every `["tasks", userId, ...]` key, so existing call sites keep
 *    working unchanged while remaining user-scoped.
 *
 * `AUTHENTICATED_USER` is the placeholder used before a user is known. Queries
 * that use it are `enabled: false` until a real id exists, so it never caches.
 */
const AUTHENTICATED_USER = "pending-user";

function scope(userId: string | undefined): string {
  return userId ?? AUTHENTICATED_USER;
}

export const queryKeys = {
  taskRoot: () => ["tasks"] as const,

  taskList: (userId: string | undefined, listKey: string) =>
    ["tasks", scope(userId), listKey] as const,

  /**
   * Exact lifetime task counts.
   *
   * Deliberately a separate key from `taskList`: these counts are computed by
   * Postgres and are exact, whereas `taskList` holds the capped UI list. Sharing
   * a key would let a truncated page satisfy an exact-count query.
   */
  lifetimeTaskStats: (userId: string | undefined) =>
    ["tasks", scope(userId), "lifetime-stats"] as const,

  /** Stable identity for a set of task ids, so the tag map key does not churn. */
  taskIdSet: (taskIds: string[]) => {
    const sorted = [...taskIds].sort();
    let hash = 0;
    for (const id of sorted) {
      for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
      }
    }
    return `${sorted.length}-${(hash >>> 0).toString(36)}`;
  },

  /**
   * Root for every task-tag map entry, so a tag mutation can invalidate all
   * loaded batches at once.
   */
  taskTagMapRoot: () => ["task-tag-map"] as const,

  /**
   * One batch of the task-tag map, keyed by the ids that batch contains.
   *
   * Keying per batch rather than over the whole visible set is what makes
   * loading another page cheap: the existing batches keep their cache entries
   * and only the newly appended ids are fetched. Keyed by the whole set, every
   * page load invalidated the whole entry and re-sent every id already seen.
   *
   * `taskIdSet` is order-independent and carries a length prefix, so the key is
   * stable for the same ids and cannot collide across different-sized sets.
   */
  taskTagMapChunk: (userId: string | undefined, chunkIds: string[]) =>
    ["task-tag-map", scope(userId), queryKeys.taskIdSet(chunkIds)] as const,

  taskDetail: (userId: string | undefined, taskId: string | undefined) =>
    ["tasks", scope(userId), "detail", taskId] as const,

  taskReminders: (userId: string | undefined, taskId: string | undefined) =>
    ["tasks", scope(userId), "detail", taskId, "reminders"] as const,

  taskSubtasks: (userId: string | undefined, taskId: string | undefined) =>
    ["tasks", scope(userId), "detail", taskId, "subtasks"] as const,

  taskTags: (userId: string | undefined, taskId: string | undefined) =>
    ["tasks", scope(userId), "detail", taskId, "tags"] as const,

  notificationRoot: () => ["notifications"] as const,

  notificationList: (userId: string | undefined) =>
    ["notifications", scope(userId), "list"] as const,

  notificationUnreadCount: (userId: string | undefined) =>
    ["notifications", scope(userId), "unread-count"] as const,

  shareOverview: (userId: string | undefined) =>
    ["share-overview", scope(userId)] as const,

  taskShares: (userId: string | undefined, taskId: string) =>
    ["shares", scope(userId), taskId] as const,

  tags: (userId: string | undefined) => ["tags", scope(userId)] as const,

  processReminders: (userId: string | undefined) =>
    ["process-reminders", scope(userId)] as const,
};
