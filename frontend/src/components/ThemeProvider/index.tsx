import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { revealTheme, type RevealOrigin } from "@/lib/themeReveal";

type Theme = "light" | "dark";

type ThemeProviderProps = {
  children: React.ReactNode;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  /**
   * With `origin` (a point in viewport px, usually the toggle's centre) the
   * new theme spreads out from there; without it the switch is instant.
   */
  setTheme: (theme: Theme, origin?: RevealOrigin) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
);

/**
 * Same rule as the pre-paint script in index.html: a stored choice wins; with
 * none yet (or a legacy "system"), start from the OS scheme once. The app does
 * not keep following the OS after that; the toggle is the only switch.
 */
const initialTheme = (storageKey: string): Theme => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall back to the OS scheme */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const paintTheme = (theme: Theme) => {
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  // Lets the browser paint form controls, scrollbars and the caret in the
  // matching scheme instead of forcing light chrome onto a dark page.
  root.style.colorScheme = theme;
};

export function ThemeProvider({
  children,
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => initialTheme(storageKey));

  useEffect(() => {
    paintTheme(theme);
  }, [theme]);

  const value = useMemo<ThemeProviderState>(
    () => ({
      theme,
      setTheme: (next: Theme, origin?: RevealOrigin) => {
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          /* storage unavailable — keep the in-memory choice */
        }
        if (!origin || next === theme) {
          setTheme(next);
          return;
        }
        // The class goes on synchronously so the view transition snapshots
        // the new theme; the effect above then re-applies the same class.
        revealTheme(origin, () => {
          paintTheme(next);
          setTheme(next);
        });
      },
    }),
    [theme, storageKey],
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
