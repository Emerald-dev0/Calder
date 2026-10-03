"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "calder_theme";

/**
 * Inline script injected into <head> so the theme attribute is set
 * synchronously before first paint (zero flash of wrong theme).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${STORAGE_KEY}")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  setTheme: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  resolvedTheme: "light",
  setMode: () => {},
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>("system");
  const [resolved, setResolved] = React.useState<ResolvedTheme>("light");

  React.useEffect(() => {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";
      const valid: ThemeMode =
        saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
      setModeState(valid);
      const next = resolveTheme(valid);
      setResolved(next);
      document.documentElement.dataset.theme = next;
    } catch {
      // ignore storage errors
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      if (mode === "system") {
        const next = mq.matches ? "dark" : "light";
        setResolved(next);
        document.documentElement.dataset.theme = next;
      }
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [mode]);

  const setMode = React.useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    try {
      localStorage.setItem(STORAGE_KEY, nextMode);
    } catch {
      // ignore storage errors
    }
    const nextResolved = resolveTheme(nextMode);
    setResolved(nextResolved);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = nextResolved;
    }
  }, []);

  const toggle = React.useCallback(() => {
    const next: ThemeMode = resolved === "dark" ? "light" : "dark";
    setMode(next);
  }, [resolved, setMode]);

  const value = React.useMemo(
    () => ({
      mode,
      resolved,
      resolvedTheme: resolved,
      setMode,
      setTheme: setMode,
      toggle,
    }),
    [mode, resolved, setMode, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, resolved, setMode, toggle } = useTheme();

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
        aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
        title={`Theme: ${resolved} (click to toggle)`}
      >
        {resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    );
  }

  return (
    <div className="ds-tabs" role="radiogroup" aria-label="Theme preference">
      {(
        [
          { id: "light", label: "Light", icon: Sun },
          { id: "dark", label: "Dark", icon: Moon },
          { id: "system", label: "System", icon: Monitor },
        ] as const
      ).map((item) => {
        const Icon = item.icon;
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(item.id)}
            className={`ds-tab ${active ? "is-active" : ""}`}
          >
            <Icon size={13} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
