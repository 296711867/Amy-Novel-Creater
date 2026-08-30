export const themes = [
  "coral",
  "sage",
  "studio",
  "pastel",
  "midnight",
] as const;
export type ThemeId = (typeof themes)[number];

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("amy-novel:theme", theme);
}

export function initializeTheme(): void {
  const stored = localStorage.getItem("amy-novel:theme") as ThemeId | null;
  applyTheme(stored && themes.includes(stored) ? stored : "coral");
}
