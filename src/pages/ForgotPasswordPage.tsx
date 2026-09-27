import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "@/hooks/useAuthContext";
import { isValidEmail, NEUTRAL_RESET_MESSAGE } from "@/services/passwordResetService";
import { getFieldErrorId } from "@/utils/fieldErrorA11y";

/**
 * Requests a password-reset email.
 *
 * The confirmation shown after a successful submit is the same for every
 * address, and the form is replaced rather than left on screen, so the page
 * gives no indication of whether an account exists — not by wording, timing
 * cue, or which controls remain available. The address is not echoed back after
 * submit for the same reason.
 */
export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldError("");

    if (!email.trim()) {
      setFieldError("Please enter your email address.");
      return;
    }
    if (!isValidEmail(email)) {
      setFieldError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const result = await requestPasswordReset(email);
      if (result.ok) {
        setSent(true);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-xl font-semibold text-primary-600 mb-8 justify-center">
          <Bell size={24} />
          SmartTodo
        </div>
        <div className="card p-8">
          {sent ? (
            <>
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                Check your email
              </h1>
              {/* Same neutral copy regardless of whether the address is registered. */}
              <p className="text-neutral-500 dark:text-neutral-400 mb-6">{NEUTRAL_RESET_MESSAGE}</p>
              <p className="text-neutral-500 dark:text-neutral-400 mb-6 text-sm">
                The link expires after a short time. If it does not arrive, check your spam
                folder.
              </p>
              <Link to="/login" className="btn-primary w-full inline-block text-center">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                Reset your password
              </h1>
              <p className="text-neutral-500 dark:text-neutral-400 mb-8">
                Enter your email address and we'll send you a reset link
              </p>

              {error && (
                <div className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    aria-invalid={!!fieldError}
                    aria-describedby={fieldError ? getFieldErrorId("email", "forgot-password") : undefined}
                    className={`input ${fieldError ? "border-error-500 focus:border-error-500 focus:ring-error-200" : ""}`}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {fieldError && (
                    <p id={getFieldErrorId("email", "forgot-password")} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldError}</p>
                  )}
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                <Link
                  to="/login"
                  className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
                >
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}