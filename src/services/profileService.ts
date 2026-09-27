import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Profile } from "@/types";

/**
 * Reading and updating the signed-in user's own profile row.
 *
 * `profiles` is the canonical, single source of truth for the user's timezone.
 * Nothing else in the app may hold a second copy of it, which is why the
 * Settings screen routes its writes through here and then through the auth
 * state rather than updating the table behind React's back.
 *
 * Every function returns a structured result instead of throwing. A profile
 * read is not a user-initiated action with an error to show: it runs on startup
 * and on every auth-state change, so a transient failure must be reportable
 * without ever interrupting application start.
 */
export type ProfileResult =
  | { ok: true; profile: Profile | null }
  | { ok: false; error: string };

/** The next profile state, plus the error to surface, for a given result. */
export interface ProfileStateTransition {
  profile: Profile | null;
  error: string | null;
}

/**
 * Reduces a `ProfileResult` into the next in-memory profile state.
 *
 * On success the row replaces whatever was held before and any previous error
 * is cleared. On failure the existing profile is **preserved** and the error is
 * surfaced. Preserving matters: blanking the profile on a transient read error
 * would silently drop the user back to `DEFAULT_TIMEZONE`, which is exactly the
 * class of bug this module exists to prevent.
 *
 * Pure and exported so that rule is directly testable.
 */
export function nextProfileState(
  current: Profile | null,
  result: ProfileResult
): ProfileStateTransition {
  if (!result.ok) {
    return { profile: current, error: result.error };
  }
  return { profile: result.profile, error: null };
}

const TIMEZONE_UPDATE_FAILED =
  "We couldn't update your timezone. Please try again.";

/**
 * Maps a profile write failure to copy the user can act on.
 *
 * Only the classifications that carry extra information (permission, network)
 * replace the operation-specific sentence; everything else would otherwise
 * render as a confusing near-duplicate of the generic fallback.
 */
function profileWriteError(error: unknown): string {
  const mapped = getServiceErrorMessage(error);
  return mapped === "Something went wrong. Please try again."
    ? TIMEZONE_UPDATE_FAILED
    : mapped;
}

/**
 * Reads the profile row for one user.
 *
 * A missing row is a successful read of `null`, not an error: RLS guarantees
 * the caller can only ever read their own row, so absence means the profile
 * trigger has not populated it yet rather than that the user lacks permission.
 */
export async function fetchProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: getServiceErrorMessage(error) };
  }

  return { ok: true, profile: (data as Profile | null) ?? null };
}

/**
 * Persists a new timezone and returns the authoritative saved row.
 *
 * The write uses `.select()` so the row comes back in the same round trip and
 * the caller updates its state from the database's own value. A separate
 * write-then-refetch would leave a window in which the write had succeeded but
 * the read had not, which is the precise failure this replaces: the database
 * would hold the new timezone while the app kept using the old one.
 */
export async function updateProfileTimezone(
  userId: string,
  timezone: string
): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ timezone, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    return { ok: false, error: profileWriteError(error) };
  }

  /*
   * No returned row means the UPDATE matched nothing. Under the owner-scoped
   * RLS policy that can only mean the profile row is missing, so reporting
   * success here would claim a timezone was saved that was never written.
   */
  if (!data) {
    return { ok: false, error: TIMEZONE_UPDATE_FAILED };
  }

  return { ok: true, profile: data as Profile };
}
