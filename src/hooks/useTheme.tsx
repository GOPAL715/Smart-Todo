import { type ReactNode, useEffect, useState, useCallback } from "react";
import { ThemeContext } from "@/hooks/useThemeContext";
import type { ThemeMode } from "@/hooks/useThemeContext";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemTheme() : mode;
}

function applyClass(resolved: "light" | "dark") {
  const cl = document.documentElement.classList;
  if (resolved === "dark") cl.add("dark");
  else cl.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(mode));

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem("theme", m);
    setModeState(m);
    const r = resolve(m);
    setResolved(r);
    applyClass(r);
  }, []);

  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = getSystemTheme();
      setResolved(r);
      applyClass(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}
