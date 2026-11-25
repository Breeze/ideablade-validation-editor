// The user's settings, kept between runs in one file in the app's data folder (window-state.json): the window's size,
// position and maximised state, and what the sidebar showed per workspace (selection, folds), the recent projects,
// the folder last saved to and the panes' widths. None of this belongs in a project file: it's one user's, not the
// team's.
//
// A saved position is used only if it's still on a connected screen; otherwise the window opens centred on the
// primary one, at the saved size if that fits. Every function takes the file's path, so the tests can use their own.
import type { BrowserWindow, Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

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

/** A sidebar selection: a metadata file (and the map in it, for TS and C#), and its settings or one of its models. */
export interface SavedSelection {
  path?: string;
  name?: string;
  kind: 'document' | 'model';
  model?: string;
}

/** Folded in the sidebar: files by path, maps by path and name ('c:\x\client.ts#adminMetadata'). */
export interface SavedFolds {
  files: string[];
  maps: string[];
}

/** The sidebar's and the right pane's widths in pixels; a missing one is at its default. */
export interface PaneLayout {
  sidebar?: number;
  side?: number;
}

/** The file's contents: whatever it holds, read loosely (it may come from an older or newer version). */
type StateFile = Record<string, unknown>;

/** True for a value that is a finite number. Number.isFinite narrows nothing, so this does it for the checks below. */
const isNumber = (v: unknown): v is number => Number.isFinite(v);

/** The bounds to open with: the saved ones when they're still on a screen, else the default size. */
export function loadWindowState(file: string, displays: ScreenArea[]): WindowState {
  let saved: StateFile;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
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

/** The whole file, or {} when there's none yet or it doesn't read. */
function readFile(file: string): StateFile {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as StateFile) : {};
  } catch {
    return {};
  }
}

/** Writes part of the file, keeping the rest: the window's bounds and the selections share it. */
function updateFile(file: string, change: (state: StateFile) => StateFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(change(readFile(file)), null, 2));
  } catch {
    // not worth failing over
  }
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
    updateFile(file, (state) => ({ ...state, ...bounds, maximized: win.isMaximized() }));
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

// What was selected in the sidebar (a model, or a file's settings), per workspace: the project file, or the first
// metadata file when there's no project. A user setting, like the window's place, so it's kept here and not in the
// project file. The most recent 50 workspaces are kept.
const MAX_SELECTIONS = 50;

/** The selection saved for a workspace (`key`: its project or first metadata file), if any. */
export function getSelection(file: string, key: string): SavedSelection | undefined {
  const selections = readFile(file)['selections'];
  return selections && typeof selections === 'object' ? (selections as Record<string, SavedSelection>)[key] : undefined;
}

/** Saves a workspace's selection, as its most recent entry. */
export function setSelection(file: string, key: string, selection: SavedSelection | undefined): void {
  updateFile(file, (state) => ({ ...state, selections: withEntry(state['selections'], key, selection) }));
}

/** An object of entries by workspace with this one set (last: the most recent), the oldest beyond 50 dropped. */
function withEntry(entries: unknown, key: string, value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(entries && typeof entries === 'object' ? (entries as Record<string, unknown>) : {}) };
  delete result[key]; // re-added last: the most recent at the end
  if (value) result[key] = value;
  const keys = Object.keys(result);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SELECTIONS))) delete result[old];
  return result;
}

// Which files and maps are folded in the sidebar, per workspace like the selection: files by path, maps by path and
// name ("C:\x\client.ts#adminMetadata"), so they're found again when the project opens next time.

/** The folded files and maps, as saved: lists of strings only. */
export function getFolds(file: string, key: string): SavedFolds | undefined {
  const folds = readFile(file)['folds'];
  const entry: unknown = folds && typeof folds === 'object' ? (folds as Record<string, unknown>)[key] : undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []);
  const e = entry as Record<string, unknown>;
  return { files: strings(e['files']), maps: strings(e['maps']) };
}

/** Saves them; nothing folded removes the workspace's entry. */
export function setFolds(file: string, key: string, folds: Partial<SavedFolds> | undefined): void {
  const empty = !folds || (!folds.files?.length && !folds.maps?.length);
  updateFile(file, (state) => ({
    ...state,
    folds: withEntry(state['folds'], key, empty ? undefined : { files: folds.files ?? [], maps: folds.maps ?? [] }),
  }));
}

// The project used last, reopened when the editor starts without files on its command line, and the ones before it,
// for File → Open Recent Project. User settings too.
const MAX_RECENT_PROJECTS = 10;

/** The last project's path, if there is one and its file is still there. */
export function getLastProject(file: string): string | undefined {
  const last = readFile(file)['lastProject'];
  return typeof last === 'string' && fs.existsSync(last) ? last : undefined;
}

/**
 * A path as compared: resolved (one kind of slash), and in lower case where file names ignore case (Windows, and macOS
 * by default). On Linux, names that differ only in case are different files.
 */
const samePathKey = (p: string): string => (process.platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase());

/**
 * The recent projects, the most recent first, each once (however its path was written), without the ones that have
 * been moved or deleted since.
 */
export function getRecentProjects(file: string): string[] {
  const recent = readFile(file)['recentProjects'];
  if (!Array.isArray(recent)) return [];
  const seen = new Set<string>();
  return recent
    .filter((p): p is string => {
      if (typeof p !== 'string' || seen.has(samePathKey(p)) || !fs.existsSync(p)) return false;
      seen.add(samePathKey(p));
      return true;
    })
    .map((p) => path.resolve(p));
}

/** Makes a project the last one, and the first of the recent ones (once, however its path was written). */
export function setLastProject(file: string, projectPath: string): void {
  updateFile(file, (state) => {
    const before: unknown[] = Array.isArray(state['recentProjects']) ? state['recentProjects'] : [];
    const others = before.filter((p): p is string => typeof p === 'string' && samePathKey(p) !== samePathKey(projectPath));
    return { ...state, lastProject: projectPath, recentProjects: [projectPath, ...others].slice(0, MAX_RECENT_PROJECTS) };
  });
}

/** Nothing to reopen: the project was closed. It stays in the recent list. */
export function clearLastProject(file: string): void {
  updateFile(file, (state) => {
    const { lastProject: _lastProject, ...rest } = state;
    return rest;
  });
}

/** Empties the recent list. The last project is kept: it's still the one to reopen. */
export function clearRecentProjects(file: string): void {
  updateFile(file, (state) => ({ ...state, recentProjects: [] }));
}

// The folder last chosen in a Save dialog, where saving the next new file starts. A user setting too.

/** The folder, if one was chosen and it's still there. */
export function getLastSaveFolder(file: string): string | undefined {
  const folder = readFile(file)['lastSaveFolder'];
  return typeof folder === 'string' && fs.existsSync(folder) ? folder : undefined;
}

/** Remembers the folder a file was just saved to, for the next new file's Save dialog. */
export function setLastSaveFolder(file: string, folder: string): void {
  updateFile(file, (state) => ({ ...state, lastSaveFolder: folder }));
}

// The panes' widths (the splitters): the sidebar's and the right pane's, in pixels. User settings too.

/** The saved widths: whole, positive numbers only; a missing one is at its default. */
export function getLayout(file: string): PaneLayout | undefined {
  const layout = readFile(file)['layout'];
  if (!layout || typeof layout !== 'object') return undefined;
  const width = (v: unknown): number | undefined => (isNumber(v) && v > 0 ? Math.round(v) : undefined);
  const l = layout as Record<string, unknown>;
  return { sidebar: width(l['sidebar']), side: width(l['side']) };
}

/** Saves the panes' widths as the user left them; only the two known ones are kept. */
export function setLayout(file: string, layout: PaneLayout | undefined): void {
  updateFile(file, (state) => ({ ...state, layout: { sidebar: layout?.sidebar, side: layout?.side } }));
}
