import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import { normalizePageSize, REQUIRED_TIEBREAKER, type Page } from "@/services/pagination";
import type { Notification } from "@/types";

/**
 * Rows fetched per page of the notification panel.
 *
 * This replaces a flat `.limit(100)`, which silently hid a user's oldest
 * notifications with no indication they existed. Paging makes the remainder
 * reachable, and the exact total is displayed so the panel can say how much is
 * still available.
 */
export const NOTIFICATION_PAGE_SIZE = 25;

export async function listNotifications(): Promise<Notification[]> {
  const firstPage = await listNotificationsPage({ offset: 0 });
  return firstPage.rows;
}

/**
 * One page of notifications, newest first, plus the exact total.
 *
 * Ordering keeps the existing `created_at DESC` and adds `id DESC` as a
 * tiebreaker. Without it, two notifications created in the same millisecond
 * (a reminder batch can do this) have an arbitrary relative order, so a row
 * could land on page 1 and again on page 2, or be skipped between them.
 *
 * The unread count is deliberately *not* derived from these rows: it is a
 * separate exact query (`getUnreadCount`) over the whole table, so the badge is
 * unaffected by which pages happen to be loaded.
 */
export async function listNotificationsPage(options?: {
  offset?: number;
  limit?: number;
}): Promise<Page<Notification>> {
  const limit = normalizePageSize(options?.limit, NOTIFICATION_PAGE_SIZE);
  const offset = Math.max(0, options?.offset ?? 0);

  const { data, error, count } = await supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order(REQUIRED_TIEBREAKER, { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(getServiceErrorMessage(error));

  return { rows: (data ?? []) as Notification[], total: count ?? 0 };
}

export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);
  if (error) throw new Error(getServiceErrorMessage(error));
  return count ?? 0;
}

export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) throw new Error(getServiceErrorMessage(error));
}

export async function markAllAsRead(): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("is_read", false);
  if (error) throw new Error(getServiceErrorMessage(error));
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId);
  if (error) throw new Error(getServiceErrorMessage(error));
}
