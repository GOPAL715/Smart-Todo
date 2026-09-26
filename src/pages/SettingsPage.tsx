import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuthContext";
import { useTheme } from "@/hooks/useThemeContext";
import { supabase } from "@/services/supabase";
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from "@/utils/dateTime";
import { ArrowLeft, Globe, Check, Search, Sun, Moon, Monitor } from "lucide-react";

function zoneLabel(tz: string): string {
  try {
    const city = tz.split("/").pop() ?? tz;
    const region = tz.includes("/") ? tz.split("/")[0].replace(/_/g, " ") : "UTC";
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return `${city.replace(/_/g, " ")} · ${region} · ${offset ?? ""}`;
  } catch {
    return tz;
  }
}

const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
];

export function SettingsPage() {
  const { user, profile } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();

  const [selected, setSelected] = useState(profile?.timezone || DEFAULT_TIMEZONE);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (profile?.timezone) setSelected(profile.timezone);
  }, [profile?.timezone]);

  const zones = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = TIMEZONE_OPTIONS;
    if (!q) return all;
    return all.filter((tz) => tz.toLowerCase().includes(q) || zoneLabel(tz).toLowerCase().includes(q));
  }, [search]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setStatus(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ timezone: selected, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
      setStatus({ tone: "success", text: "Timezone updated." });
    } catch {
      setStatus({ tone: "error", text: "We couldn't update your timezone. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-4 text-sm">
        <ArrowLeft size={16} />
        Back
      </button>

      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">Settings</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Manage your display preferences and timezone.
      </p>

      {/* Appearance */}
      <div className="card p-6 space-y-4 mb-6">
        <div className="flex items-center gap-2">
          <Sun size={18} className="text-primary-600 dark:text-primary-400" />
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Appearance</h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                  active
                    ? "border-primary-500 bg-primary-50 dark:bg-primary-950"
                    : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-800"
                }`}
              >
                <opt.icon
                  size={24}
                  className={active ? "text-primary-600 dark:text-primary-400" : "text-neutral-500 dark:text-neutral-400"}
                />
                <span
                  className={`text-sm font-medium ${
                    active ? "text-primary-700 dark:text-primary-300" : "text-neutral-600 dark:text-neutral-300"
                  }`}
                >
                  {opt.label}
                </span>
                {active && (
                  <span className="w-2 h-2 rounded-full bg-primary-500" />
                )}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-neutral-400">
          {mode === "system"
            ? "Following your operating system preference."
            : `Using ${mode} mode.`}
        </p>
      </div>

      {/* Timezone */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-primary-600 dark:text-primary-400" />
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Timezone</h2>
        </div>

        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Task dates and times you enter are interpreted in your timezone, and shown
          in it across the app. Changing it does not move your existing tasks.
        </p>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search timezones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
          {zones.length === 0 ? (
            <p className="p-4 text-sm text-neutral-400">No timezones match your search.</p>
          ) : (
            zones.map((tz) => {
              const isCurrent = tz === selected;
              return (
                <button
                  key={tz}
                  type="button"
                  onClick={() => setSelected(tz)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                    isCurrent
                      ? "bg-primary-50 dark:bg-primary-950"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${isCurrent ? "text-primary-700 dark:text-primary-400" : "text-neutral-800 dark:text-neutral-200"}`}>
                      {tz}
                    </p>
                    <p className="text-xs text-neutral-400 truncate">{zoneLabel(tz)}</p>
                  </div>
                  {isCurrent && <Check size={16} className="text-primary-600 dark:text-primary-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <p className="text-xs text-neutral-400">
          Current: <span className="text-neutral-600 dark:text-neutral-300 font-medium">{profile?.timezone || DEFAULT_TIMEZONE}</span>
          {" · "}
          New tasks you create after saving will use the selected zone.
        </p>

        {status && (
          <p
            className={`text-sm rounded-lg px-3 py-2 animate-fade-in ${
              status.tone === "error"
                ? "bg-error-50 text-error-700 border border-error-200 dark:bg-error-950 dark:text-error-400 dark:border-error-800"
                : "bg-success-50 text-success-700 border border-success-200 dark:bg-success-950 dark:text-success-400 dark:border-success-800"
            }`}
          >
            {status.text}
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving || selected === profile?.timezone} className="btn-primary">
            {saving ? "Saving..." : "Save timezone"}
          </button>
          <Link to="/app/dashboard" className="btn-secondary">Done</Link>
        </div>
      </div>
    </div>
  );
}
