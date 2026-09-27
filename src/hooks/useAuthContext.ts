import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import type { ProfileResult } from "@/services/profileService";

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  /**
   * The most recent profile read/write failure, or null when the last attempt
   * succeeded.
   *
   * A profile read runs on startup and on every auth-state change, so a
   * transient failure must be observable rather than swallowed. It never blocks
   * the application: `loading` still resolves and the previously held profile is
   * kept, so the app stays usable while this is set.
   */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the profile row for the signed-in user. */
  refreshProfile: () => Promise<ProfileResult>;
  /**
   * Persists a new timezone and updates the in-memory profile from the row the
   * database returns, so `useUserTimezone()` reports it immediately.
   */
  updateProfileTimezone: (timezone: string) => Promise<ProfileResult>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
