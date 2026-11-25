// IPC: the model sources (Breeze metadata, TS and C# files), watched so the editor always offers the current models.
// Two kinds of watching:
// - source patterns (a folder of DTOs: dir/**/*.{ts,cs}, project/source-patterns.ts): the folders they point at, so
//   files appearing or disappearing there reach the renderer as the patterns' new lists of files
//   (`sources:pattern-matches`). One set of patterns at a time, the editor's; called again when they change.
// - the source files themselves: each one read again when it changes, and sent to the renderer (`source:changed`).
import { ipcMain } from 'electron';
import fsSync, { type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import { expandPatterns, watchPatterns } from '../project/source-patterns';
import { withTypeScriptModels } from '../typescript/read-file';
import { mainWindow } from '../window/main-window';

/** Stops watching the previous patterns' folders, if any. */
let stopPatternWatch: (() => void) | undefined;

/** A watched source: its watcher (while the file is there) and the timer that waits for a save to settle. */
interface WatchedFile {
  watcher: FSWatcher | undefined;
  timer: NodeJS.Timeout | undefined;
}
const watchers = new Map<string, WatchedFile>(); // path -> { watcher, timer }

/** Registers the `sources:*` handlers. */
export function registerSourceHandlers(): void {
  /** Patterns made absolute (relative ones to `baseDir`), each with the files it matches now. */
  ipcMain.handle('sources:expand-patterns', (_e, patterns: string[], baseDir: string | undefined) => expandPatterns(patterns, baseDir));

  /**
   * Watches these patterns' folders instead of the previous ones (none for an empty list); changes go to the renderer
   * as `sources:pattern-matches`.
   */
  ipcMain.handle('sources:watch-patterns', async (_e, patterns: string[] | undefined) => {
    stopPatternWatch?.();
    stopPatternWatch = undefined;
    if (!patterns?.length) return;
    try {
      stopPatternWatch = await watchPatterns(patterns, (matches) => mainWindow()?.webContents.send('sources:pattern-matches', matches));
    } catch {
      // a folder that isn't there (yet): nothing to watch
    }
  });

  /** Watches exactly these source files: new ones are added, the ones no longer listed stop being watched. */
  ipcMain.handle('sources:watch', (_e, paths: string[]) => {
    for (const [p, entry] of watchers) {
      if (!paths.includes(p)) {
        entry.watcher?.close();
        clearTimeout(entry.timer);
        watchers.delete(p);
      }
    }
    for (const p of paths) {
      if (!watchers.has(p)) watchers.set(p, watchFile(p));
    }
  });
}

/**
 * Watches one source file and sends it to the renderer, read again (with its models, for TS), whenever it changes;
 * or an error when it can't be read (deleted, say).
 */
function watchFile(filePath: string): WatchedFile {
  const entry: WatchedFile = { watcher: undefined, timer: undefined };
  const fire = (): void => {
    clearTimeout(entry.timer);
    // Editors often write a file in several steps (truncate, write, rename): wait until it settles.
    entry.timer = setTimeout(async () => {
      try {
        const text = await fs.readFile(filePath, 'utf8');
        mainWindow()?.webContents.send('source:changed', withTypeScriptModels({ path: filePath, text }));
      } catch (e) {
        mainWindow()?.webContents.send('source:changed', { path: filePath, error: String(e) });
      }
      // A rename-based save replaces the file, which ends fs.watch on some platforms: watch again.
      rewatch();
    }, 300);
  };
  const rewatch = (): void => {
    try {
      entry.watcher?.close();
      entry.watcher = fsSync.watch(filePath, fire);
      entry.watcher.on('error', () => {});
    } catch {
      entry.watcher = undefined; // gone for now; the renderer can reload it by hand
    }
  };
  rewatch();
  return entry;
}
