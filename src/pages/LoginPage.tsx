import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Bell, CheckCircle2, Clock, Calendar } from "lucide-react";

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      navigate("/app/dashboard");
    } catch (err) {
      console.error("Sign-in failed:", err);
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-neutral-950">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 text-white p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-semibold">
            <Bell size={24} />
            SmartTodo
          </div>
        </div>
        <div className="space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Never miss a task again.
          </h1>
          <p className="text-primary-100 text-lg">
            Smart reminders that notify you at the right time — 1 hour before,
            30 minutes before, 10 minutes before, and at start time.
          </p>
          <div className="space-y-4 pt-4">
            <FeatureRow icon={<Clock size={20} />} text="Automatic status transitions" />
            <FeatureRow icon={<Bell size={20} />} text="Smart in-app notifications" />
            <FeatureRow icon={<Calendar size={20} />} text="Calendar view of all tasks" />
            <FeatureRow icon={<CheckCircle2 size={20} />} text="Overdue detection" />
          </div>
        </div>
        <p className="text-primary-200 text-sm">2026 SmartTodo</p>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 text-xl font-semibold text-primary-600 mb-8">
            <Bell size={24} />
            SmartTodo
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">Welcome back</h2>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8">Sign in to your account</p>

          {error && (
            <div className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                className="input"
                placeholder="--------"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500 bg-opacity-30">
        {icon}
      </div>
      <span className="text-primary-50">{text}</span>
    </div>
  );
}
