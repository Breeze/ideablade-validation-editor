// IPC: files. The file dialogs (open, save, add a source or a folder of sources) and reading and writing files by path.
// The renderer turns files into text and back itself; a TypeScript file it reads comes with its models, validators and
// functions (typescript/read-file.ts). Each `ipcMain.handle` answers an `invoke` from preload.ts.
import { app, dialog, ipcMain, type FileFilter } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { settingsFilePath } from '../settings/settings-file';
import { getLastSaveFolder, setLastSaveFolder } from '../settings/user-settings';
import type { ReadFile } from '../types';
import { withTypeScriptModels } from '../typescript/read-file';
import { mainWindow } from '../window/main-window';

// Validation metadata lives in JSON files, or in TypeScript and C# files (see typescript/metadata-read.ts and
// src/lib/cs-metadata.ts).
const metadataFilters: FileFilter[] = [
  { name: 'Validation metadata and projects', extensions: ['json', 'ts', 'cs', 'ivproj'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'TypeScript', extensions: ['ts'] },
  { name: 'C#', extensions: ['cs'] },
  { name: 'IdeaBlade Validation Project', extensions: ['ivproj'] },
];

/** Registers the `file:*` handlers. */
export function registerFileHandlers(): void {
  /** File → Open: asks for metadata files or a project, and returns each with its text (none when cancelled). */
  ipcMain.handle('file:open', async (_e, title: string): Promise<ReadFile[]> => {
    const result = await dialog.showOpenDialog(mainWindow(), { title, properties: ['openFile', 'multiSelections'], filters: metadataFilters });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async (p) => ({ path: p, text: await fs.readFile(p, 'utf8') })));
  });

  /**
   * Reads a file by path; a TypeScript file comes with its models, validators and functions
   * (typescript/read-file.ts).
   */
  ipcMain.handle('file:read', async (_e, filePath: string): Promise<ReadFile> =>
    withTypeScriptModels({ path: filePath, text: await fs.readFile(filePath, 'utf8') }),
  );

  /** Writes a file the renderer has already turned into text; returns its path. */
  ipcMain.handle('file:save', async (_e, filePath: string, text: string): Promise<string> => {
    await fs.writeFile(filePath, text, 'utf8');
    return filePath;
  });

  /**
   * Asks where to save; the format follows the extension chosen. The renderer writes the file. A file that has a path
   * starts next to it; a new one (just a name) in the folder last chosen here, else the open project's, else Documents.
   */
  ipcMain.handle('file:choose-save-path', async (_e, suggestion: string | undefined, projectDir: string | undefined): Promise<string | undefined> => {
    const filters = metadataFilters.slice(1, 4); // the metadata formats
    const ext = path.extname(suggestion ?? '').slice(1).toLowerCase();
    filters.sort((a, b) => Number(b.extensions[0] === ext) - Number(a.extensions[0] === ext)); // the current format first
    const name = suggestion ?? 'validation.metadata.json';
    const defaultPath = path.isAbsolute(name)
      ? name
      : path.join(getLastSaveFolder(settingsFilePath()) ?? projectDir ?? app.getPath('documents'), name);
    const result = await dialog.showSaveDialog(mainWindow(), { defaultPath, filters });
    if (result.canceled || !result.filePath) return undefined;
    setLastSaveFolder(settingsFilePath(), path.dirname(result.filePath));
    return result.filePath;
  });

  /**
   * File → Add source: asks for model sources and returns each read, with its models for TS (none when cancelled).
   */
  ipcMain.handle('file:open-source', async (): Promise<ReadFile[]> => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'Add a model source',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Model sources', extensions: ['json', 'ts', 'cs'] },
        { name: 'Breeze metadata', extensions: ['json'] },
        { name: 'TypeScript', extensions: ['ts'] },
        { name: 'C#', extensions: ['cs'] },
      ],
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async (p) => withTypeScriptModels({ path: p, text: await fs.readFile(p, 'utf8') })));
  });

  /** Add folder: a folder to take the sources from, starting in the project's folder; undefined when cancelled. */
  ipcMain.handle('file:choose-source-folder', async (_e, defaultDir: string | undefined) => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: 'Add a folder of model sources (TS and C# files, in it and its subfolders)',
      defaultPath: defaultDir,
      properties: ['openDirectory'],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
}
