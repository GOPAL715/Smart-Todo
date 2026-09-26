import { type ReactNode, useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/services/supabase";
import { clearAuthenticatedCaches } from "@/utils/pwaCache";
import { getAuthErrorMessage } from "@/utils/authErrors";
import { AuthContext, type AuthContextValue } from "@/hooks/useAuthContext";
import type { Profile } from "@/types";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) return;
    setProfile(data as Profile | null);
  }, []);

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
        void loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        void loadProfile(newSession.user.id);
      } else {
        setProfile(null);
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
    setProfile(null);
    setSession(null);
    await clearUserCaches();
  }, [clearUserCaches]);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    profile,
    session,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
