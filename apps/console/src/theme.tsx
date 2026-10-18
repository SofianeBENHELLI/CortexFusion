import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { SunMoon } from "lucide-react";

type Theme = "system" | "light" | "dark";
const key = "cortexfusion.console.theme";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: "system", setTheme: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "system";
  });
  useLayoutEffect(() => {
    document.documentElement.style.colorScheme =
      theme === "system" ? "light dark" : theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(key, theme);
    } catch {}
  }, [theme]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeControl() {
  const { theme, setTheme } = useContext(ThemeContext);
  return (
    <label className="theme-control">
      <SunMoon size={16} aria-hidden="true" />
      <span className="sr-only">Apparence</span>
      <select
        aria-label="Apparence"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        <option value="system">Système</option>
        <option value="light">Clair</option>
        <option value="dark">Sombre</option>
      </select>
    </label>
  );
}
