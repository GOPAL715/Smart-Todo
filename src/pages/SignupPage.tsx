import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuthContext";
import { getAuthErrorMessage } from "@/utils/authErrors";
import { Bell } from "lucide-react";

function getPasswordStrength(password: string): { score: number; label: string; suggestions: string[] } {
  if (!password) return { score: 0, label: "", suggestions: [] };
  let score = 0;
  const suggestions: string[] = [];
  if (password.length >= 8) score++; else suggestions.push("At least 8 characters");
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++; else suggestions.push("Uppercase and lowercase letters");
  if (/\d/.test(password)) score++; else suggestions.push("A number");
  if (/[^a-zA-Z0-9]/.test(password)) score++; else suggestions.push("A special character");

  const labels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
  return { score, label: labels[score] ?? "Very strong", suggestions };
}

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

  const strength = getPasswordStrength(password);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Please enter your name.";
    if (!email.trim()) {
      e.email = "Please enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = "Please enter a valid email address.";
    }
    if (!password) {
      e.password = "Please enter a password.";
    } else if (password.length < 8) {
      e.password = "Password must be at least 8 characters.";
    } else if (strength.score < 3) {
      e.password = "Password is too weak. Please use a stronger password.";
    }
    if (!confirmPassword) {
      e.confirmPassword = "Please confirm your password.";
    } else if (password !== confirmPassword) {
      e.confirmPassword = "Passwords do not match.";
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
      await signUp(name.trim(), email.trim().toLowerCase(), password);
      navigate("/app/dashboard");
    } catch (err) {
      setError(getAuthErrorMessage(err));
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
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">Create account</h2>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8">Start managing your tasks smartly</p>

          {error && (
            <div className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                required
                className="input"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldErrors.name && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {fieldErrors.email && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                className="input"
                placeholder="At least 8 characters with mixed case, number, and special char"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setShowPasswordRequirements(true)}
                onBlur={() => setShowPasswordRequirements(false)}
              />
              {fieldErrors.password && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.password}</p>}
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
                className="input"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {fieldErrors.confirmPassword && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{fieldErrors.confirmPassword}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Already have an account?{" "}
            <Link to="/login" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
