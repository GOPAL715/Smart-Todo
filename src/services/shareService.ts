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
  permission: SharePermission,
  currentUserEmail?: string | null
): Promise<ShareResult> {
  /*
   * Client-side pre-check for the caller's own address.
   *
   * This is a usability guard, not a security control: the database still
   * re-checks and still returns `self`. It exists so the common mistake is
   * caught before a request is made, and so the user gets an immediate message
   * without a round trip. Because the same generic message is used for `self`
   * and `not_found`, this reveals nothing about any *other* account.
   */
  if (currentUserEmail && isSameEmail(currentUserEmail, email)) {
    return { ok: false, reason: "self" };
  }

  const { data, error } = await supabase.rpc("share_task", {
    p_task_id: taskId,
    p_email: email,
    p_permission: permission,
  });
  if (error) {
    // A transport or RPC failure never reveals its detail to the UI.
    return { ok: false, reason: "unknown" };
  }
  return toResult(data);
}

/** Case-insensitive, whitespace-tolerant email comparison. */
export function isSameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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

/**
 * The single message shown for every share failure that would otherwise reveal
 * whether an email address is registered.
 *
 * Declared before the message table because the table references it.
 */
export const GENERIC_SHARE_FAILURE =
  "We couldn't share this task. Check the address and your access, then try again.";

export const SHARE_FAILURE_MESSAGES: Record<ShareFailureReason, string> = {
  not_authenticated: "Please sign in again to share this task.",
  invalid_permission: "Choose either view-only or can edit.",
  invalid_email: "Enter the email address of the person you want to share with.",
  not_owner: "Only the person who created this task can change who it is shared with.",
  /*
   * Account enumeration (P1-7).
   *
   * `share_task` reports `not_found` when no account matches the address and
   * `self` when the address is the caller's own. Displaying either verbatim
   * turns the share form into an oracle: any authenticated user who owns one
   * task can submit arbitrary addresses and learn which ones are registered.
   *
   * Both are now collapsed into a single message that is also used for
   * unexpected failures, so the observable response for "no such user",
   * "already shared / your own address" and "something went wrong" is
   * identical. The distinct reason codes are still returned to the caller
   * (they are useful for logging and for the dedicated self-share guard below)
   * but are never rendered.
   *
   * This is a UI-layer mitigation only. The RPC still returns a distinguishable
   * reason in its JSON body, so a caller inspecting the network response can
   * still tell the cases apart. Closing that fully requires a database change
   * to `share_task`, which is out of scope here; see the audit notes.
   */
  not_found: GENERIC_SHARE_FAILURE,
  self: GENERIC_SHARE_FAILURE,
  not_permitted: "You do not have permission to change this share.",
  unknown: GENERIC_SHARE_FAILURE,
};

/**
 * True when a failure reason must not be shown verbatim because doing so would
 * disclose whether an account exists.
 *
 * Exported so the rule is unit-testable and so a future caller cannot
 * accidentally re-introduce a specific message for one of these reasons.
 */
export function isEnumerationSensitiveReason(reason?: ShareFailureReason): boolean {
  return reason === "not_found" || reason === "self" || reason === "unknown";
}

export function shareFailureMessage(reason?: ShareFailureReason): string {
  const key = reason ?? "unknown";
  if (isEnumerationSensitiveReason(key)) {
    return GENERIC_SHARE_FAILURE;
  }
  return SHARE_FAILURE_MESSAGES[key] ?? GENERIC_SHARE_FAILURE;
}
