"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  mounted: boolean;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

const THEME_STORAGE_KEY = "agent-flow-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const restoreTheme = window.setTimeout(() => {
      setThemeState(readStoredTheme());
      setMounted(true);
    }, 0);

    return () => window.clearTimeout(restoreTheme);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    function applyTheme() {
      const nextResolvedTheme =
        theme === "system" ? getSystemTheme() : theme;
      document.documentElement.classList.toggle(
        "dark",
        nextResolvedTheme === "dark",
      );
      setResolvedTheme(nextResolvedTheme);
      writeStoredTheme(theme);
    }

    applyTheme();

    if (theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [mounted, theme]);

  const value = useMemo(
    () => ({
      mounted,
      resolvedTheme,
      setTheme: setThemeState,
      theme,
    }),
    [mounted, resolvedTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

function writeStoredTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures; the active DOM theme still applies for this session.
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}
