import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function readStoredTheme(defaultTheme: Theme, storage?: ThemeStorage): Theme {
  try {
    const stored = (storage ?? window.localStorage).getItem("theme");
    return stored === "light" || stored === "dark" ? stored : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function persistTheme(theme: Theme, storage?: ThemeStorage): void {
  try {
    (storage ?? window.localStorage).setItem("theme", theme);
  } catch {
    // 在隱私模式或嵌入式瀏覽器中可能無法寫入；主題切換仍應正常運作。
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      return readStoredTheme(defaultTheme);
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      persistTheme(theme);
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
