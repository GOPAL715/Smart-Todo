import { supabase } from "@/services/supabase";
import type { ShareOverview, TaskShare, SharePermission } from "@/types";
import { getServiceErrorMessage } from "@/utils/serviceErrors";

/*
 * Every share mutation runs through a database function that re-checks the
 * caller's relationship to the task. The client never writes share rows
 * directly, so a compromised or hand-crafted request cannot grant access.
 */
export type ShareFailureReason =
  | "not_authenticated"
  | "invalid_permission"
  | "invalid_email"
  | "not_owner"
  | "not_found"
  | "self"
  | "not_permitted"
  | "unknown";

export interface ShareResult {
  ok: boolean;
  reason?: ShareFailureReason;
  updated?: boolean;
  recipient?: string;
}

function toResult(data: unknown): ShareResult {
  if (!data || typeof data !== "object") return { ok: false, reason: "unknown" };
  const raw = data as Record<string, unknown>;

  // share_task reports success as `shared`, the other functions as `ok`.
  const ok = raw.shared === true || raw.ok === true;
  if (!ok) {
    return { ok: false, reason: (raw.reason as ShareFailureReason) ?? "unknown" };
  }

  return {
    ok: true,
    updated: raw.updated === true,
    recipient: typeof raw.recipient === "string" ? raw.recipient : undefined,
  };
}

export async function shareTask(
  taskId: string,
  email: string,
  permission: SharePermission
): Promise<ShareResult> {
  const { data, error } = await supabase.rpc("share_task", {
    p_task_id: taskId,
    p_email: email,
    p_permission: permission,
  });
  if (error) {
    return { ok: false, reason: "unknown" };
  }
  return toResult(data);
}

export async function updateSharePermission(
  shareId: string,
  permission: SharePermission
): Promise<ShareResult> {
  const { data, error } = await supabase.rpc("update_task_share", {
    p_share_id: shareId,
    p_permission: permission,
  });
  if (error) {
    return { ok: false, reason: "unknown" };
  }
  return toResult(data);
}

export async function revokeShare(shareId: string): Promise<ShareResult> {
  const { data, error } = await supabase.rpc("revoke_task_share", { p_share_id: shareId });
  if (error) {
    return { ok: false, reason: "unknown" };
  }
  return toResult(data);
}

export async function listTaskShares(taskId: string): Promise<TaskShare[]> {
  const { data, error } = await supabase.rpc("list_task_shares", { p_task_id: taskId });
  if (error) {
    return [];
  }
  const raw = data as { ok?: boolean; shares?: TaskShare[] } | null;
  return raw?.ok ? raw.shares ?? [] : [];
}

export async function getShareOverview(): Promise<ShareOverview> {
  const { data, error } = await supabase.rpc("list_share_overview");
  if (error) throw new Error(getServiceErrorMessage(error));
  const raw = data as
    | { ok?: boolean; shared_with_me?: ShareOverview["shared_with_me"]; shared_by_me?: ShareOverview["shared_by_me"] }
    | null;

  if (!raw?.ok) {
    return { shared_with_me: [], shared_by_me: [] };
  }
  return {
    shared_with_me: raw.shared_with_me ?? [],
    shared_by_me: raw.shared_by_me ?? [],
  };
}

export const SHARE_FAILURE_MESSAGES: Record<ShareFailureReason, string> = {
  not_authenticated: "Please sign in again to share this task.",
  invalid_permission: "Choose either view-only or can edit.",
  invalid_email: "Enter the email address of the person you want to share with.",
  not_owner: "Only the person who created this task can change who it is shared with.",
  not_found: "We couldn't find an account with that email. Please check the address and try again.",
  self: "This task is already yours.",
  not_permitted: "You do not have permission to change this share.",
  unknown: "We couldn't update sharing just now. Please try again.",
};

export function shareFailureMessage(reason?: ShareFailureReason): string {
  return SHARE_FAILURE_MESSAGES[reason ?? "unknown"] ?? SHARE_FAILURE_MESSAGES.unknown;
}
