// A file read for the renderer, with what a TypeScript file holds: its models (models.ts) and the application's own
// validators and expression functions (app-validators.ts). The `file:*` handlers (ipc/files.ts) pass every file they
// read through withTypeScriptModels, and so does the source watcher (ipc/sources.ts) when a file changes.
import type { ReadFile } from '../types';
import { parseTypeScriptApp } from './app-validators';
import { parseTypeScript } from './models';

/**
 * Adds the models, validators and functions (or `parseError`) to a file read for the renderer, for a TS file; other
 * files are returned as they are. Called for every file the renderer opens or a watcher reloads (ipc/files.ts,
 * ipc/sources.ts).
 */
export function withTypeScriptModels<T extends ReadFile>(file: T): T {
  if (!/\.tsx?$/i.test(file.path) || file.text === undefined) return file;
  try {
    return { ...file, models: parseTypeScript(file.text, file.path), ...parseTypeScriptApp(file.text, file.path) };
  } catch (e) {
    return { ...file, parseError: String((e as Error | undefined)?.message ?? e) };
  }
}
