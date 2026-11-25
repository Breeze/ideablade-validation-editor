// The user's settings file: one JSON file in the app's data folder (window-state.json, a name kept from when it held
// only the window's place). It holds the window's bounds (window-bounds.ts), what the sidebar showed per workspace and
// the panes' widths (user-settings.ts), and the recent projects (recent-projects.ts). None of this belongs in a
// project file: it's one user's, not the team's.
//
// Each of those reads the whole file and writes back only its own keys, through readSettings and updateSettings here,
// so they never overwrite each other. Every function takes the file's path, so the tests can use their own; the app
// passes settingsFilePath().
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** The file's contents: whatever it holds, read loosely (it may come from an older or newer version). */
export type SettingsFile = Record<string, unknown>;

/** The app's settings file, in its data folder (Electron's `userData`, under %APPDATA% on Windows). */
export const settingsFilePath = (): string => path.join(app.getPath('userData'), 'window-state.json');

/** True for a value that is a finite number. Number.isFinite narrows nothing, so this does it for the checks. */
export const isNumber = (v: unknown): v is number => Number.isFinite(v);

/** The whole file, or {} when there's none yet or it doesn't read. */
export function readSettings(file: string): SettingsFile {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as SettingsFile) : {};
  } catch {
    return {};
  }
}

/** Writes part of the file, keeping the rest: the window's bounds and the user's settings share it. */
export function updateSettings(file: string, change: (state: SettingsFile) => SettingsFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(change(readSettings(file)), null, 2));
  } catch {
    // not worth failing over
  }
}
