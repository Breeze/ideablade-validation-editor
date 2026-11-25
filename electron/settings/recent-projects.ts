// The project used last, reopened when the editor starts without files on its command line, and the ones before it,
// for File → Open Recent Project (window/menu.ts) and the page shown when nothing is open. Kept in the settings file
// (settings-file.ts) as `lastProject` and `recentProjects`; ipc/project.ts records each project used, ipc/settings.ts
// answers the renderer's questions about them.
import fs from 'node:fs';
import path from 'node:path';
import { readSettings, updateSettings } from './settings-file';

/** How many recent projects File → Open Recent Project lists. */
const MAX_RECENT_PROJECTS = 10;

/** The last project's path, if there is one and its file is still there. */
export function getLastProject(file: string): string | undefined {
  const last = readSettings(file)['lastProject'];
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
  const recent = readSettings(file)['recentProjects'];
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
  updateSettings(file, (state) => {
    const before: unknown[] = Array.isArray(state['recentProjects']) ? state['recentProjects'] : [];
    const others = before.filter((p): p is string => typeof p === 'string' && samePathKey(p) !== samePathKey(projectPath));
    return { ...state, lastProject: projectPath, recentProjects: [projectPath, ...others].slice(0, MAX_RECENT_PROJECTS) };
  });
}

/** Nothing to reopen: the project was closed. It stays in the recent list. */
export function clearLastProject(file: string): void {
  updateSettings(file, (state) => {
    const { lastProject: _lastProject, ...rest } = state;
    return rest;
  });
}

/** Empties the recent list. The last project is kept: it's still the one to reopen. */
export function clearRecentProjects(file: string): void {
  updateSettings(file, (state) => ({ ...state, recentProjects: [] }));
}
