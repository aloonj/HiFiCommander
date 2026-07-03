import { THEMES, THEME_VAR_KEYS } from './themes';

const STORAGE_KEY = 'hificommander-theme';

export function getSavedTheme() {
  return localStorage.getItem(STORAGE_KEY) ?? 'system';
}

export function selectTheme(name) {
  localStorage.setItem(STORAGE_KEY, name);
  refreshTheme();
}

// Re-applies whatever theme is currently saved. Called on load and whenever
// the OS light/dark preference changes, so "System" keeps tracking it live.
export function refreshTheme() {
  const root = document.documentElement;
  const theme = THEMES[getSavedTheme()];

  if (!theme) {
    for (const key of THEME_VAR_KEYS) root.style.removeProperty(key);
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
    return;
  }

  root.classList.add('dark');
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value);
}
