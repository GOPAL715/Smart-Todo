import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import type { ProfileResult } from "@/services/profileService";
import type {
  ResetRequestResult,
  UpdatePasswordResult,
} from "@/services/passwordResetService";

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
  /**
   * True while the session in hand was established by a password-recovery link.
   *
   * A recovery link signs the user in, so `user` alone cannot distinguish this
   * from an ordinary login. The reset screen needs the difference to decide
   * whether to offer the new-password form or explain that the link is no
   * longer usable. It is a display concern only: the session itself is still
   * Supabase's to accept or reject, and nothing here grants an action.
   */
  isRecoverySession: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Emails a recovery link to `email`.
   *
   * The result says whether the request could be sent, never whether an account
   * exists; see `NEUTRAL_RESET_MESSAGE`.
   */
  requestPasswordReset: (email: string) => Promise<ResetRequestResult>;
  /**
   * Sets a new password for the current session.
   *
   * Supabase Auth rejects this without a valid session, which is the only
   * authorization that matters here.
   */
  updatePassword: (newPassword: string) => Promise<UpdatePasswordResult>;
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
