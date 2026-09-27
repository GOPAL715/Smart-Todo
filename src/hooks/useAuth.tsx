import { type ReactNode, useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/services/supabase";
import { clearAuthenticatedCaches } from "@/utils/pwaCache";
import { getAuthErrorMessage } from "@/utils/authErrors";
import {
  fetchProfile,
  nextProfileState,
  updateProfileTimezone as persistTimezone,
  type ProfileResult,
} from "@/services/profileService";
import {
  requestPasswordReset as sendPasswordReset,
  updatePassword as persistPassword,
  type ResetRequestResult,
  type UpdatePasswordResult,
} from "@/services/passwordResetService";
import { AuthContext, type AuthContextValue } from "@/hooks/useAuthContext";
import type { Profile } from "@/types";

const NOT_SIGNED_IN: ProfileResult = {
  ok: false,
  error: "You are not signed in.",
};

interface ProfileState {
  profile: Profile | null;
  error: string | null;
}

const NO_PROFILE: ProfileState = { profile: null, error: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Profile and its error are one state object so they can never be updated
  // inconsistently, and so a single atomic update replaces both.
  const [profileState, setProfileState] = useState<ProfileState>(NO_PROFILE);
  const [loading, setLoading] = useState(true);
  /*
   * Set when Supabase reports PASSWORD_RECOVERY, and cleared by any later event
   * that carries a session or by sign-out.
   *
   * `detectSessionInUrl` is enabled, so a recovery link is exchanged for a real
   * session by Supabase before this sees it; the app never parses the link's
   * tokens itself. The flag records only how the current session was obtained,
   * so the reset screen knows to offer the new-password form. It is cleared
   * when the user signs out, and when a session arrives by any other route, so
   * it cannot survive into an unrelated login.
   */
  const [isRecoverySession, setIsRecoverySession] = useState(false);
  const queryClient = useQueryClient();
  const { profile, error: profileError } = profileState;

  /*
   * Folds a result into the profile state.
   *
   * This used to be `if (error) return;`, which discarded the failure entirely:
   * the profile silently kept its previous value (usually `null`) and the user
   * was quietly treated as being in `DEFAULT_TIMEZONE`. `nextProfileState` keeps
   * the good profile and records the error instead, so the failure is
   * observable without any consumer re-reading the row.
   *
   * The previous state is read from the updater's argument rather than from
   * `profileState`, because two profile loads can overlap (startup plus an
   * auth-state change) and a closure value would let the slower response
   * overwrite the newer one.
   */
  const applyProfileResult = useCallback((result: ProfileResult) => {
    setProfileState((current) => nextProfileState(current.profile, result));
  }, []);

  const loadProfile = useCallback(
    async (userId: string): Promise<ProfileResult> => {
      const result = await fetchProfile(userId);
      applyProfileResult(result);
      return result;
    },
    [applyProfileResult]
  );

  /**
   * Discards every cached server response and cancels anything in flight.
   *
   * Sign-out previously cleared only the legacy Cache Storage entry, which
   * current builds never create, so the previous user's tasks and notifications
   * stayed in memory and could render for whoever signed in next. PWA cache
   * isolation is preserved and still runs alongside this.
   */
  const clearUserCaches = useCallback(async () => {
    queryClient.cancelQueries();
    queryClient.clear();
    await clearAuthenticatedCaches();
  }, [queryClient]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        // `loading` must settle on a failed profile read too, or the app would
        // sit on the ProtectedRoute spinner forever.
        void loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        /*
         * Any event other than PASSWORD_RECOVERY that carries a session means
         * the user arrived by an ordinary sign-in or a token refresh, so a
         * recovery flag left over from a previous visit must not leak into it.
         */
        if (event === "PASSWORD_RECOVERY") {
          setIsRecoverySession(true);
        } else if (event !== "INITIAL_SESSION") {
          setIsRecoverySession(false);
        }
        void loadProfile(newSession.user.id);
      } else {
        setIsRecoverySession(false);
        setProfileState(NO_PROFILE);
        // Covers explicit sign-out, expiry and revocation alike.
        void clearUserCaches();
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [clearUserCaches, loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(getAuthErrorMessage(error));
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw new Error(getAuthErrorMessage(error));
    if (data.user) await loadProfile(data.user.id);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfileState(NO_PROFILE);
    setSession(null);
    setIsRecoverySession(false);
    await clearUserCaches();
  }, [clearUserCaches]);

  const refreshProfile = useCallback(async (): Promise<ProfileResult> => {
    const userId = session?.user?.id;
    if (!userId) return NOT_SIGNED_IN;
    return loadProfile(userId);
  }, [loadProfile, session]);

  /**
   * Writes the timezone and folds the returned row straight into auth state.
   *
   * Settings previously updated `profiles` itself and stopped there, so the
   * database moved to the new zone while `useUserTimezone()` kept returning the
   * old one: the screen reported "Timezone updated" and every task created
   * afterwards in that session was converted with the stale offset. Routing the
   * write through here makes the in-memory profile the single source of truth,
   * and the returned row is what updates it, so the two cannot disagree.
   */
  const updateProfileTimezone = useCallback(
    async (timezone: string): Promise<ProfileResult> => {
      const userId = session?.user?.id;
      if (!userId) return NOT_SIGNED_IN;

      const result = await persistTimezone(userId, timezone);
      applyProfileResult(result);
      return result;
    },
    [applyProfileResult, session]
  );

  /**
   * Emails a recovery link.
   *
   * Delegated to the service so the redirect can never be influenced by the
   * caller, and so the result carries no hint about whether the address is
   * registered.
   */
  const requestPasswordReset = useCallback(
    async (email: string): Promise<ResetRequestResult> => sendPasswordReset(email),
    []
  );

  /**
   * Applies a new password to the current session.
   *
   * On success the session is still a recovery session, so the flag is cleared
   * here: the user has completed the reset and is now simply signed in, and
   * leaving it set would send them back to the reset screen on a later visit.
   */
  const updatePassword = useCallback(
    async (newPassword: string): Promise<UpdatePasswordResult> => {
      const result = await persistPassword(newPassword);
      if (result.ok) setIsRecoverySession(false);
      return result;
    },
    []
  );

  const value: AuthContextValue = {
    user: session?.user ?? null,
    profile,
    session,
    loading,
    profileError,
    isRecoverySession,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    refreshProfile,
    updateProfileTimezone,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
