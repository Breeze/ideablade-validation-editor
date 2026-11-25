// The colour theme: dark (the default, as in VS Code), light, or whatever Windows uses. styles.css has the colours;
// this sets `data-theme` on <html>. Electron's native theme follows the same setting (electron/main.cjs), so the
// window frame, menus and dialogs match, and with 'system' prefers-color-scheme reflects Windows.

export type ThemeSetting = 'dark' | 'light' | 'system';

export const THEME_LABELS: Record<ThemeSetting, string> = { dark: 'Dark', light: 'Light', system: 'Follow Windows' };

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;

export function effectiveTheme(setting: ThemeSetting): 'dark' | 'light' {
  if (setting === 'system') return darkQuery?.matches ? 'dark' : 'light';
  return setting;
}

export function applyTheme(setting: ThemeSetting): void {
  document.documentElement.dataset['theme'] = effectiveTheme(setting);
}

/** Calls back when Windows switches between light and dark (it matters for 'system'). */
export function onSystemThemeChange(handler: () => void): void {
  darkQuery?.addEventListener('change', handler);
}

/** The saved setting, read before Angular starts (see main.ts). Kept with the other settings (editor-store.ts). */
export function storedTheme(): ThemeSetting {
  try {
    const theme = (JSON.parse(localStorage.getItem('editor.settings') ?? '{}') as { theme?: string }).theme;
    return theme === 'light' || theme === 'system' ? theme : 'dark';
  } catch {
    return 'dark';
  }
}
