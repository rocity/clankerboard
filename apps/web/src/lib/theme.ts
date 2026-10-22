import { useSyncExternalStore } from "react";

/**
 * The localStorage key for the theme choice: "light", "dark", or "system".
 * The inline script in index.html reads the same key before first paint, and
 * .claude/skills/redesign/SKILL.md records it, so keep all three in step.
 */
export const themeStorageKey = "agentkanban-theme";

export type ThemePreference = "light" | "dark" | "system";

const preferences: readonly ThemePreference[] = ["light", "dark", "system"];
const darkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(themeStorageKey);
    return preferences.find((p) => p === stored) ?? "system";
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && matchMedia(darkQuery).matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(themeStorageKey);
    else localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Storage can be blocked. The choice then lasts until the page reloads.
  }
  applyTheme(preference);
  current = preference;
  for (const listener of listeners) listener();
}

let current = readPreference();

// Follow the system setting live while the choice is "system".
matchMedia(darkQuery).addEventListener("change", () => {
  if (current === "system") applyTheme("system");
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "system" as const,
  );
}
