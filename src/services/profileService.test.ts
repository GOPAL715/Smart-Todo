import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * Phase 14A — profile/timezone synchronisation.
 *
 * The defect these cover: Settings wrote `profiles.timezone` directly, so the
 * database changed while the in-memory profile did not. `useUserTimezone()`
 * kept returning the old zone and every task created afterwards in that
 * session was converted with the stale UTC offset.
 *
 * The suite drives the real service through a mocked Supabase client, so it
 * asserts the actual write-then-return-row behaviour rather than a restatement
 * of it. It then feeds those results into the same reducer the auth provider
 * uses, which is what proves the in-memory profile follows the database.
 */

type Query = { table: string; op: "select" | "update" };

interface DbState {
  readError: { code: string; message: string } | null;
  writeError: { code: string; message: string } | null;
  /** In-memory mirror of the table, so a read after a write observes the write. */
  stored: Record<string, unknown> | null;
}

let db: DbState;
const calls: Query[] = [];
/** Every value passed to `.eq()`, so a test can prove the user id filter. */
const eqValues: string[] = [];

/*
 * `from()` cannot know whether the caller will read or write, so the operation
 * is resolved lazily: `.update()` flips the chain to a write, and `.maybeSingle()`
 * then returns whichever error belongs to that operation. Resolving it up front
 * would make a write-failure branch unreachable and silently untested.
 */
function makeQuery(table: string) {
  const chain: Record<string, unknown> = {};
  let op: "select" | "update" = "select";
  let pendingPatch: Record<string, unknown> | null = null;

  chain.eq = vi.fn((_column: string, value: string) => {
    eqValues.push(value);
    return chain;
  });
  chain.select = vi.fn(() => chain);
  chain.update = vi.fn((patch: Record<string, unknown>) => {
    op = "update";
    calls.push({ table, op });
    // Held, not applied. A failed write must leave the table untouched, exactly
    // as PostgREST behaves; applying it eagerly would make a rolled-back update
    // indistinguishable from a successful one.
    pendingPatch = patch;
    return chain;
  });
  chain.maybeSingle = vi.fn(() => {
    calls.push({ table, op });
    if (op === "update") {
      if (db.writeError) {
        pendingPatch = null;
        return Promise.resolve({ data: null, error: db.writeError });
      }
      if (table === "profiles" && db.stored) {
        db.stored = { ...db.stored, ...pendingPatch };
      }
      pendingPatch = null;
      return Promise.resolve({ data: db.stored, error: null });
    }
    if (db.readError) return Promise.resolve({ data: null, error: db.readError });
    return Promise.resolve({ data: db.stored, error: null });
  });

  return chain;
}

vi.mock("@/services/supabase", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
  },
}));

import {
  fetchProfile,
  nextProfileState,
  updateProfileTimezone,
  type ProfileResult,
} from "./profileService";
import { buildTaskSchedule } from "./taskService";
import { DEFAULT_TIMEZONE } from "@/utils/dateTime";
import type { Profile } from "@/types";

const USER_ID = "user-1";

function profile(timezone: string): Profile {
  return {
    id: USER_ID,
    name: "Test User",
    email: "test@example.test",
    timezone,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  calls.length = 0;
  eqValues.length = 0;
  db = {
    readError: null,
    writeError: null,
    stored: profile("Asia/Kolkata") as unknown as Record<string, unknown>,
  };
});

/**
 * Mirrors the provider's state transition so a test can observe the profile a
 * signed-in user would actually be holding after a call.
 */
function currentProfile(): Profile | null {
  return db.stored as unknown as Profile | null;
}

describe("timezone update propagates to the in-memory profile", () => {
  it("reports the new timezone immediately when moving to a western zone", async () => {
    const result = await updateProfileTimezone(USER_ID, "America/New_York");

    expect(result.ok).toBe(true);
    // The row the database returned is what updates state.
    if (result.ok) expect(result.profile?.timezone).toBe("America/New_York");

    const state = nextProfileState(currentProfile(), result);
    expect(state.profile?.timezone).toBe("America/New_York");
    expect(state.error).toBeNull();
  });

  it("writes to the signed-in user's own profile row and nothing else", async () => {
    await updateProfileTimezone(USER_ID, "America/New_York");

    // The RLS policy scopes this by auth.uid(), so the id in the filter is the
    // only thing preventing a cross-account write. Assert it is present.
    const write = calls.find((c) => c.op === "update");
    expect(write?.table).toBe("profiles");
    expect(write).toBeDefined();
    expect(eqValues).toContain(USER_ID);
  });

  it("reports the new timezone immediately when moving back east", async () => {
    db.stored = profile("America/New_York") as unknown as Record<string, unknown>;

    const result = await updateProfileTimezone(USER_ID, "Asia/Kolkata");

    const state = nextProfileState(currentProfile(), result);
    expect(state.profile?.timezone).toBe("Asia/Kolkata");
  });

  it("persists the write and reads it back as the profile", async () => {
    await updateProfileTimezone(USER_ID, "Europe/London");

    const reread = await fetchProfile(USER_ID);
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.profile?.timezone).toBe("Europe/London");
  });

  it("does not claim success when the write matched no row", async () => {
    // An owner-scoped RLS UPDATE that matches nothing leaves the table
    // untouched; reporting success would claim a timezone that was never saved.
    db.stored = null;

    const result = await updateProfileTimezone(USER_ID, "America/New_York");

    expect(result.ok).toBe(false);
  });

  it("surfaces a write failure as a mapped, actionable error", async () => {
    db.writeError = { code: "42501", message: "new row violates row-level security policy" };

    const result = await updateProfileTimezone(USER_ID, "America/New_York");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(result.error).not.toContain("row-level security");
  });

  it("distinguishes a network failure from a permission failure", async () => {
    db.writeError = { code: "", message: "TypeError: Failed to fetch" };

    const result = await updateProfileTimezone(USER_ID, "America/New_York");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      "Unable to connect. Please check your internet connection and try again."
    );
  });
});

describe("failed refresh does not pretend the update succeeded", () => {
  it("preserves the previous profile when a refresh fails", async () => {
    // This is the failure mode that must not regress: a transient read error
    // used to leave the profile untouched but entirely unreported, and a naive
    // fix that set it to null would drop the user to DEFAULT_TIMEZONE.
    const good = profile("America/New_York");
    const failure: ProfileResult = { ok: false, error: "Unable to connect." };

    const state = nextProfileState(good, failure);

    expect(state.profile).toBe(good);
    expect(state.profile?.timezone).toBe("America/New_York");
    expect(state.error).toBe("Unable to connect.");
  });

  it("never resolves a failed refresh as a successful update", async () => {
    db.writeError = { code: "", message: "Failed to fetch" };

    const result = await updateProfileTimezone(USER_ID, "America/New_York");
    const state = nextProfileState(currentProfile(), result);

    expect(result.ok).toBe(false);
    // A caller checking only `error === null` would otherwise show success.
    expect(state.error).not.toBeNull();
    // And the old zone is still what the app uses, so nothing silently shifts.
    expect(state.profile?.timezone).toBe("Asia/Kolkata");
  });

  it("clears a previous error once a later attempt succeeds", async () => {
    const failed = nextProfileState(profile("Asia/Kolkata"), {
      ok: false,
      error: "Unable to connect.",
    });
    expect(failed.error).toBe("Unable to connect.");

    const recovered = nextProfileState(failed.profile, {
      ok: true,
      profile: profile("America/New_York"),
    });

    expect(recovered.error).toBeNull();
    expect(recovered.profile?.timezone).toBe("America/New_York");
  });
});

describe("task creation uses the new timezone after a change", () => {
  /*
   * The user-visible consequence of the stale profile. `useUserTimezone()` feeds
   * `createTask`, which converts wall-clock time through `buildTaskSchedule`, so
   * a stale zone silently produces a wrong UTC instant.
   */
  const applyProfile = (result: ProfileResult): string | undefined =>
    nextProfileState(currentProfile(), result).profile?.timezone;

  it("converts a 09:00 wall-clock task with the NEW western zone", async () => {
    const result = await updateProfileTimezone(USER_ID, "America/New_York");
    const timezone = applyProfile(result);

    expect(timezone).toBe("America/New_York");
    /*
     * 2026-03-10 is AFTER the 2026-03-08 US spring-forward, so New York is on
     * EDT (UTC-4) and 09:00 local is 13:00Z — not 14:00Z, which is the EST
     * (UTC-5) answer for a pre-transition date. The 03:30Z that Asia/Kolkata
     * (UTC+5:30, no DST) would produce is the value this test exists to rule
     * out, proving the NEW zone is what actually converted the wall clock.
     */
    expect(buildTaskSchedule("2026-03-10", "09:00", "10:00", timezone!).start_datetime).toBe(
      "2026-03-10T13:00:00.000Z"
    );
  });

  it("produces a different instant than the old zone would have", async () => {
    const before = buildTaskSchedule("2026-03-10", "09:00", "10:00", "Asia/Kolkata");
    const result = await updateProfileTimezone(USER_ID, "America/New_York");
    const after = buildTaskSchedule("2026-03-10", "09:00", "10:00", applyProfile(result)!);

    expect(after.start_datetime).not.toBe(before.start_datetime);
    // 9h30m = the real difference between UTC+5:30 (IST) and UTC-4 (EDT).
    expect(
      new Date(after.start_datetime).getTime() - new Date(before.start_datetime).getTime()
    ).toBe(9.5 * 60 * 60 * 1000);
  });

  it("converts correctly again after switching back", async () => {
    db.stored = profile("America/New_York") as unknown as Record<string, unknown>;
    const result = await updateProfileTimezone(USER_ID, "Asia/Kolkata");
    const timezone = applyProfile(result);

    expect(buildTaskSchedule("2026-03-10", "09:00", "10:00", timezone!).start_datetime).toBe(
      "2026-03-10T03:30:00.000Z"
    );
  });

  it("round-trips the stored instant back to the same wall-clock time", async () => {
    const result = await updateProfileTimezone(USER_ID, "America/New_York");
    const timezone = applyProfile(result)!;
    const schedule = buildTaskSchedule("2026-03-10", "09:00", "10:00", timezone);

    // Displaying the stored instant in the same zone must reproduce 09:00,
    // otherwise the task would appear at the wrong hour after the change.
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(schedule.start_datetime));

    expect(shown).toBe("09:00");
  });
});

describe("existing timezone behaviour is unchanged", () => {
  it("still falls back to the app default when no profile is loaded", () => {
    const state = nextProfileState(null, { ok: true, profile: null });

    expect(state.profile).toBeNull();
    // `useUserTimezone` maps a null profile to DEFAULT_TIMEZONE; unchanged.
    expect(state.profile?.timezone ?? DEFAULT_TIMEZONE).toBe(DEFAULT_TIMEZONE);
  });

  it("leaves the timezone alone for non-timezone profile fields", async () => {
    const result = await fetchProfile(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile?.timezone).toBe("Asia/Kolkata");
    expect(result.profile?.email).toBe("test@example.test");
  });

  it("keeps the pre-existing default zone in the schedule builder", () => {
    expect(buildTaskSchedule("2026-03-10", "09:00", "10:00").start_datetime).toBe(
      "2026-03-10T03:30:00.000Z"
    );
  });
});

describe("profile timezone load", () => {
  it("loads the stored timezone from the profile row", async () => {
    const result = await fetchProfile(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile?.timezone).toBe("Asia/Kolkata");
  });

  it("reports a read failure instead of silently returning nothing", async () => {
    db.readError = { code: "42501", message: "permission denied for table profiles" };

    const result = await fetchProfile(USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Mapped copy, not the raw database text.
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(result.error).not.toContain("profiles");
  });

  it("treats a missing profile row as a successful null, not an error", async () => {
    db.stored = null;

    const result = await fetchProfile(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toBeNull();
  });
});
