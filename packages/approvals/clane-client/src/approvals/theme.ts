export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'clane-approvals:theme';

/**
 * The shared design system (src/ds/tokens.css) keys its dark palette off
 * `data-mode="dark"` on <html> — the main app's signal, not the hr build's
 * `data-theme`. approvals.html applies the stored value pre-paint, so this
 * module only handles runtime toggling.
 */
export const currentTheme = (): ThemeMode =>
  document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';

export const applyTheme = (mode: ThemeMode): void => {
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-mode', 'dark');
  } else {
    document.documentElement.removeAttribute('data-mode');
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode — the pre-paint script falls back to system preference */
  }
};

export const toggleTheme = (): ThemeMode => {
  const next: ThemeMode = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
};
