// The window's size, position and maximised state, kept in the settings file (settings-file.ts) between runs.
// window/main-window.ts opens the window with loadWindowState and keeps the file up to date with trackWindowState.
//
// A saved position is used only if it's still on a connected screen; otherwise the window opens centred on the
// primary one, at the saved size if that fits.
import type { BrowserWindow, Rectangle } from 'electron';
import fs from 'node:fs';
import { isNumber, updateSettings, type SettingsFile } from './settings-file';

/** The window's size the first time, or when the saved one doesn't read. */
export const DEFAULT_WINDOW_SIZE = { width: 1500, height: 950 };

/** The bounds the window opens with; `x` and `y` only when the saved place is still on a screen. */
export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

/** A screen, as far as placing the window goes: its work area (without the taskbar). Electron's Display has it. */
export interface ScreenArea {
  workArea: Rectangle;
}

/** The bounds to open with: the saved ones when they're still on a screen, else the default size. */
export function loadWindowState(file: string, displays: ScreenArea[]): WindowState {
  // Read here rather than with readSettings: a file that doesn't read means the default size, without `maximized`.
  let saved: SettingsFile;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SettingsFile;
  } catch {
    return { ...DEFAULT_WINDOW_SIZE };
  }
  const width = isNumber(saved['width']) && saved['width'] >= 400 ? saved['width'] : DEFAULT_WINDOW_SIZE.width;
  const height = isNumber(saved['height']) && saved['height'] >= 300 ? saved['height'] : DEFAULT_WINDOW_SIZE.height;
  const state: WindowState = { width, height, maximized: saved['maximized'] === true };
  const x = saved['x'];
  const y = saved['y'];
  if (isNumber(x) && isNumber(y) && isVisible({ x, y, width, height }, displays)) {
    state.x = x;
    state.y = y;
  }
  return state;
}

/** True when enough of the window (its title bar at least) is on one of the screens' work areas. */
export function isVisible(bounds: Rectangle, displays: ScreenArea[]): boolean {
  return displays.some(({ workArea: a }) => {
    const left = Math.max(bounds.x, a.x);
    const right = Math.min(bounds.x + bounds.width, a.x + a.width);
    const top = Math.max(bounds.y, a.y);
    const bottom = Math.min(bounds.y + 40, a.y + a.height); // the title bar
    return right - left >= 100 && bottom - top >= 20;
  });
}

/**
 * Saves the window's state now, and as it's moved, resized, maximised or closed. Moves and resizes come in bursts
 * while the user drags, so those are saved half a second after the last one.
 */
export function trackWindowState(win: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized()) return;
    // The normal bounds, so a maximised window restores to the size it had before.
    const bounds = win.getNormalBounds();
    updateSettings(file, (state) => ({ ...state, ...bounds, maximized: win.isMaximized() }));
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('close', save);
}
