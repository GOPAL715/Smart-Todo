import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuthContext";
import {
  getPasswordStrength,
  validateNewPassword,
  type PasswordField,
} from "@/utils/passwordPolicy";

/**
 * Sets a new password after a recovery link has established a session.
 *
 * The session is the authorization. Supabase exchanged the recovery link for a
 * real session before this screen rendered, and `updateUser` is refused without
 * one, so an invalid, expired, or already-used link lands on the "no longer
 * valid" branch below with no password form — there is no client-side check
 * standing in for the server, and nothing here parses the link's tokens.
 *
 * A signed-in user who navigates here directly is in the same position: they
 * may set their own password, which requires nothing they do not already have.
 */
export function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const validation = validateNewPassword(password, confirmPassword);
    if (!validation.ok) {
      setFieldErrors({ [validation.field]: validation.error });
      return;
    }

    setSaving(true);
    try {
      const result = await updatePassword(password);
      if (result.ok) {
        setDone(true);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  /*
   * Still resolving the session: the recovery link may not have been exchanged
   * yet, so neither "no session" nor "valid session" can be claimed.
   */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
        </div>
      </div>
    );
  }

  /*
   * No session. The link was invalid, expired, or already spent, and the app
   * has nothing to update. The password form is never rendered, so there is
   * nothing to submit and no way to probe the endpoint from here.
   */
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
        <div className="w-full max-w-md">
          <div className="card p-8 text-center">
            <div className="flex items-center gap-2 text-xl font-semibold text-primary-600 mb-6 justify-center">
              <Bell size={24} />
              SmartTodo
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
              This link is no longer valid
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 mb-6">
              Password reset links expire after a short time and can only be used once.
              Please request a new one.
            </p>
            <Link to="/forgot-password" className="btn-primary w-full inline-block text-center">
              Request a new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
        <div className="w-full max-w-md">
          <div className="card p-8 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-primary-600" />
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
              Password updated
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 mb-6">
              Your password has been changed. You are now signed in.
            </p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => navigate("/app/dashboard", { replace: true })}
            >
              Continue to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
        <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-xl font-semibold text-primary-600 mb-8 justify-center">
          <Bell size={24} />
          SmartTodo
        </div>
        <div className="card p-8">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
            Choose a new password
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8">
            Use a password you haven't used for this account before
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                className={`input ${fieldErrors.password ? "border-error-500 focus:border-error-500 focus:ring-error-200" : ""}`}
                placeholder="At least 8 characters with mixed case, number, and special char"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {fieldErrors.password && (
                <p className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.password}</p>
              )}
              {password && (
                <div className="mt-1 animate-fade-in">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full ${level <= strength.score ? "bg-primary-500" : "bg-neutral-200 dark:bg-neutral-700"}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Password strength: {strength.label}
                  </p>
                  <p className="text-xs text-neutral-400 mt-1">
                    Must contain at least 8 characters, uppercase and lowercase letters, a
                    number, and a special character.
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                className={`input ${fieldErrors.confirmPassword ? "border-error-500 focus:border-error-500 focus:ring-error-200" : ""}`}
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {fieldErrors.confirmPassword && (
                <p className="text-xs text-error-600 dark:text-error-400 mt-1">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full">
              {saving ? "Updating password..." : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
