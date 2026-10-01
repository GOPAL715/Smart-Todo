import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuthContext";
import { getAuthErrorMessage } from "@/utils/authErrors";
import { getPasswordStrength, validateNewPassword } from "@/utils/passwordPolicy";
import { getFieldErrorId } from "@/utils/fieldErrorA11y";
import { INLINE_LINK_TOUCH_CLASS, MainContent, SkipLink } from "@/components/auth/SkipLink";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { CheckEmailNotice, CHECK_EMAIL_HEADING } from "@/components/auth/CheckEmailNotice";
import { Bell, MailCheck } from "lucide-react";

export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPasswordRequirements, setShowPasswordRequirements] = useState(false);
  /*
   * Set once Supabase accepts the signup but issues no session, which is what a
   * project with email confirmation enabled does. The user is not signed in at
   * that point, so the form is replaced by the check-your-email state instead of
   * navigating into the authenticated app.
   */
  const [awaitingVerification, setAwaitingVerification] = useState(false);

  const strength = getPasswordStrength(password);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Please enter your name.";
    if (!email.trim()) {
      e.email = "Please enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = "Please enter a valid email address.";
    }
    // The same shared policy the password-reset screen uses, so a password that
    // is accepted here is never rejected there.
    const passwordCheck = validateNewPassword(password, confirmPassword);
    if (!passwordCheck.ok) {
      e[passwordCheck.field] = passwordCheck.error;
    }
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (!validate()) return;

    setLoading(true);
    try {
      const result = await signUp(name.trim(), email.trim().toLowerCase(), password);
      if (result.requiresEmailVerification) {
        setAwaitingVerification(true);
        return;
      }
      navigate("/app/dashboard");
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SkipLink />
      <MainContent className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-xl font-semibold text-primary-600 mb-8 justify-center">
          <Bell size={24} />
          Smart Todo Task Management
        </div>
        <div className="card p-8">
          {awaitingVerification ? (
            <>
              <div className="flex items-center gap-2 text-primary-600 mb-4">
                <MailCheck size={24} />
                <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                  {CHECK_EMAIL_HEADING}
                </h1>
              </div>
              <CheckEmailNotice />
              <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Already confirmed?{" "}
                <Link to="/login" className={INLINE_LINK_TOUCH_CLASS}>
                  Sign in
                </Link>
              </p>
            </>
          ) : (
            <>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">Create account</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8">Start managing your tasks smartly</p>

          {error && (
            <AuthErrorBanner>{error}</AuthErrorBanner>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                required
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? getFieldErrorId("name", "signup") : undefined}
                className="input"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldErrors.name && <p id={getFieldErrorId("name", "signup")} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? getFieldErrorId("email", "signup") : undefined}
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {fieldErrors.email && <p id={getFieldErrorId("email", "signup")} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? getFieldErrorId("password", "signup") : undefined}
                className="input"
                placeholder="At least 8 characters with mixed case, number, and special char"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setShowPasswordRequirements(true)}
                onBlur={() => setShowPasswordRequirements(false)}
              />
              {fieldErrors.password && <p id={getFieldErrorId("password", "signup")} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.password}</p>}
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
                  {showPasswordRequirements && strength.suggestions.length > 0 && (
                    <ul className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 space-y-0.5">
                      {strength.suggestions.map((s) => (
                        <li key={s}>• {s}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-neutral-400 mt-1">
                    Must contain at least 8 characters, uppercase and lowercase letters, a number, and a special character.
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                required
                aria-invalid={!!fieldErrors.confirmPassword}
                aria-describedby={fieldErrors.confirmPassword ? getFieldErrorId("confirmPassword", "signup") : undefined}
                className="input"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {fieldErrors.confirmPassword && <p id={getFieldErrorId("confirmPassword", "signup")} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.confirmPassword}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Already have an account?{" "}
            <Link to="/login" className={INLINE_LINK_TOUCH_CLASS}>
              Sign in
            </Link>
          </p>
            </>
          )}
        </div>
      </div>
      </MainContent>
    </>
  );
}
