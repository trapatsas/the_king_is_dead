import { useEffect, useState } from "react";
import { applyTheme, readTheme, rememberTheme } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);
  return (
    <button
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20.5 13.1A8.6 8.6 0 0 1 10.9 3.5a8.6 8.6 0 1 0 9.6 9.6Z" />
        )}
      </svg>
      <span className="theme-label">{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
