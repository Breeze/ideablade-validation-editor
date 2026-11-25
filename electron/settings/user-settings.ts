// What the editor remembers for the user besides the window's place and the recent projects: what the sidebar showed
// per workspace (the selection, the folded files and maps), the folder last saved to, the panes' widths, and the update
// settings. Kept in the settings file (settings-file.ts); the renderer reads and writes them through the `ui:*`
// handlers (ipc/settings.ts) and `updates:*` (ipc/updates.ts), and the Save dialog (ipc/files.ts) uses the folder.
import fs from 'node:fs';
import type { PaneLayout, SavedFolds, SavedSelection, UpdateSettings } from '../types';
import { isNumber, readSettings, updateSettings } from './settings-file';

// What was selected in the sidebar (a model, or a file's settings), per workspace: the project file, or the first
// metadata file when there's no project. A user setting, like the window's place, so it's kept here and not in the
// project file. The most recent 50 workspaces are kept.
const MAX_SELECTIONS = 50;

/** The selection saved for a workspace (`key`: its project or first metadata file), if any. */
export function getSelection(file: string, key: string): SavedSelection | undefined {
  const selections = readSettings(file)['selections'];
  return selections && typeof selections === 'object' ? (selections as Record<string, SavedSelection>)[key] : undefined;
}

/** Saves a workspace's selection, as its most recent entry. */
export function setSelection(file: string, key: string, selection: SavedSelection | undefined): void {
  updateSettings(file, (state) => ({ ...state, selections: withEntry(state['selections'], key, selection) }));
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
  const folds = readSettings(file)['folds'];
  const entry: unknown = folds && typeof folds === 'object' ? (folds as Record<string, unknown>)[key] : undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []);
  const e = entry as Record<string, unknown>;
  return { files: strings(e['files']), maps: strings(e['maps']) };
}

/** Saves them; nothing folded removes the workspace's entry. */
export function setFolds(file: string, key: string, folds: Partial<SavedFolds> | undefined): void {
  const empty = !folds || (!folds.files?.length && !folds.maps?.length);
  updateSettings(file, (state) => ({
    ...state,
    folds: withEntry(state['folds'], key, empty ? undefined : { files: folds.files ?? [], maps: folds.maps ?? [] }),
  }));
}

// The folder last chosen in a Save dialog, where saving the next new file starts.

/** The folder, if one was chosen and it's still there. */
export function getLastSaveFolder(file: string): string | undefined {
  const folder = readSettings(file)['lastSaveFolder'];
  return typeof folder === 'string' && fs.existsSync(folder) ? folder : undefined;
}

/** Remembers the folder a file was just saved to, for the next new file's Save dialog. */
export function setLastSaveFolder(file: string, folder: string): void {
  updateSettings(file, (state) => ({ ...state, lastSaveFolder: folder }));
}

// The panes' widths (the splitters): the sidebar's and the right pane's, in pixels.

/** The saved widths: whole, positive numbers only; a missing one is at its default. */
export function getLayout(file: string): PaneLayout | undefined {
  const layout = readSettings(file)['layout'];
  if (!layout || typeof layout !== 'object') return undefined;
  const width = (v: unknown): number | undefined => (isNumber(v) && v > 0 ? Math.round(v) : undefined);
  const l = layout as Record<string, unknown>;
  return { sidebar: width(l['sidebar']), side: width(l['side']) };
}

/** Saves the panes' widths as the user left them; only the two known ones are kept. */
export function setLayout(file: string, layout: PaneLayout | undefined): void {
  updateSettings(file, (state) => ({ ...state, layout: { sidebar: layout?.sidebar, side: layout?.side } }));
}

// Updates (updates/updater.ts): whether to check automatically, and whether pre-releases count. Both on by default.

/** The update settings, each at its default (on) unless saved as a boolean. */
export function getUpdateSettings(file: string): UpdateSettings {
  const saved = readSettings(file)['updates'];
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const flag = (v: unknown): boolean => (typeof v === 'boolean' ? v : true);
  return { checkAutomatically: flag(s['checkAutomatically']), includePrereleases: flag(s['includePrereleases']) };
}

/** Saves a change to the update settings (either or both); returns them as they are now. */
export function setUpdateSettings(file: string, change: Partial<UpdateSettings>): UpdateSettings {
  const settings = { ...getUpdateSettings(file) };
  if (typeof change.checkAutomatically === 'boolean') settings.checkAutomatically = change.checkAutomatically;
  if (typeof change.includePrereleases === 'boolean') settings.includePrereleases = change.includePrereleases;
  updateSettings(file, (state) => ({ ...state, updates: settings }));
  return settings;
}
