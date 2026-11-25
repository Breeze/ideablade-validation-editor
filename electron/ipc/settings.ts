// IPC: the user's settings (settings/), and what to open at startup. The renderer reads and saves the sidebar's
// selection and folds per workspace and the panes' widths (`ui:*`), lists the recent projects on the page shown when
// nothing is open, and asks once at startup what to open: the files on the command line, else the project used last.
import { app, ipcMain } from 'electron';
import path from 'node:path';
import { getLastProject, getRecentProjects } from '../settings/recent-projects';
import { settingsFilePath } from '../settings/settings-file';
import { getFolds, getLayout, getSelection, setFolds, setLayout, setSelection } from '../settings/user-settings';
import type { PaneLayout, SavedFolds, SavedSelection } from '../types';

/** Registers the `ui:*` handlers, app:recent-projects and app:startup-args. */
export function registerSettingsHandlers(): void {
  // What was selected in the sidebar, per project (or first metadata file), kept with the window's place.

  /** The panes' widths as the user left them. */
  ipcMain.handle('ui:get-layout', () => getLayout(settingsFilePath()));
  /** Saves the panes' widths (after a splitter is dragged). */
  ipcMain.on('ui:set-layout', (_e, layout: PaneLayout) => setLayout(settingsFilePath(), layout));
  /** The sidebar selection saved for a workspace. */
  ipcMain.handle('ui:get-selection', (_e, key: string) => getSelection(settingsFilePath(), key));
  /** Saves a workspace's sidebar selection. */
  ipcMain.on('ui:set-selection', (_e, key: string, selection: SavedSelection) => setSelection(settingsFilePath(), key, selection));
  /** The folded files and maps saved for a workspace. */
  ipcMain.handle('ui:get-folds', (_e, key: string) => getFolds(settingsFilePath(), key));
  /** Saves a workspace's folded files and maps. */
  ipcMain.on('ui:set-folds', (_e, key: string, folds: SavedFolds) => setFolds(settingsFilePath(), key, folds));

  /** The recent projects, the latest first, for the page shown when nothing is open. */
  ipcMain.handle('app:recent-projects', () => getRecentProjects(settingsFilePath()));

  /**
   * What to open at startup. A file passed on the command line (e.g. through the "Open with" file association).
   * Command line: a project (*.ivproj), or metadata files to open (JSON, TS or C#) and sources to load with them:
   *   electron . temphire.ivproj
   *   electron . validation.metadata.json client-validation-metadata.ts --source=breeze-metadata.json --source=src/app/view-models.ts
   * Relative paths are resolved against the working directory. Without any, the project used last, if it's still there.
   */
  ipcMain.handle('app:startup-args', () => {
    // The packaged exe's arguments start after it; `electron .` has the app's folder first.
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    const files = args.filter((a) => !a.startsWith('-') && /\.(json|ts|cs|ivproj)$/i.test(a)).map((a) => path.resolve(a));
    const sources = args.filter((a) => a.startsWith('--source=')).map((a) => path.resolve(a.slice('--source='.length)));
    // Without files to open, the project used last, if it's still there.
    if (!files.length && !sources.length) {
      const last = getLastProject(settingsFilePath());
      if (last) files.push(last);
    }
    return { files, sources };
  });
}
