// Electron main process: one window, its menu, and everything the renderer can't do itself, as IPC handlers: file
// dialogs and file I/O, reading TypeScript, the project file, watching model sources, and the user's settings. The
// renderer reaches these through the preload script (preload.ts, `window.editorHost`; its interface is EditorHost in
// src/app/services/host.ts). Each `ipcMain.handle` answers an `invoke` (the renderer awaits the result); each
// `ipcMain.on` takes a `send` that needs no answer.
//
// This file is compiled to dist-electron/main.js (package.json's "main"), next to preload.js; the Angular app is in
// dist/ and the icons in build/, both one folder up from it, in the source tree and in the packaged app alike.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, type FileFilter, type MenuItemConstructorOptions } from 'electron';
import fsSync, { type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_EXTENSION, projectFileName, findProject, readProject, writeProject, expandPatterns, watchPatterns, type ProjectToWrite } from './project';
import { readTsMetadata, writeTsMetadata, insertTsMetadata, removeTsMetadata, newTsMetadataFile, type JsonObject } from './typescript-metadata';
import { withTypeScriptModels, type ReadFile } from './typescript-models';
import {
  loadWindowState,
  trackWindowState,
  getSelection,
  setSelection,
  getFolds,
  setFolds,
  getLastProject,
  setLastProject,
  clearLastProject,
  getRecentProjects,
  clearRecentProjects,
  getLastSaveFolder,
  setLastSaveFolder,
  getLayout,
  setLayout,
  type PaneLayout,
  type SavedFolds,
  type SavedSelection,
} from './window-state';

/** The one window, created once the app is ready; the handlers below only run after that. */
let win!: BrowserWindow;
/** Set once the renderer has agreed to close (nothing unsaved, or the user said so): the next close goes through. */
let forceClose = false;

/** The window's place and the sidebar selections, a user's settings (window-state.ts). */
const windowStateFile = (): string => path.join(app.getPath('userData'), 'window-state.json');

/**
 * Creates the window where it was last closed, loads the renderer (the dev server's URL under `npm run dev`, else the
 * built Angular app in dist/), and routes closing through the renderer so it can ask about unsaved changes.
 */
function createWindow(): void {
  // The size and position it had when it was last closed (window-state.ts).
  const stateFile = windowStateFile();
  const state = loadWindowState(stateFile, screen.getAllDisplays());
  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
    // The three columns' minimum widths (300 + 460 + 400 px in styles.css, .layout) plus the frame: narrower, and the
    // right one is cut off at the window's edge.
    minWidth: 1180,
    minHeight: 500,
    show: false, // shown once placed, maximised if it was, so it doesn't jump
    backgroundColor: '#1e1e1e', // the default dark theme, until the renderer says otherwise (no white flash)
    title: 'IdeaBlade Validation Editor',
    // The packaged exe has it built in; running from source (electron .) needs it here, or Electron's own shows.
    // (Windows takes the .ico, with its small sizes; Linux a PNG. macOS uses the app bundle's.) build/ is next to
    // dist-electron/, where this file is compiled to.
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      // Compiled next to this file (dist-electron/preload.js).
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  trackWindowState(win, stateFile);

  const devUrl = process.env['ELECTRON_START_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Ask the renderer whether there are unsaved changes before closing.
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });
}

// Validation metadata lives in JSON files, or in TypeScript and C# files (see typescript-metadata.ts and
// src/lib/cs-metadata.ts).
const metadataFilters: FileFilter[] = [
  { name: 'Validation metadata and projects', extensions: ['json', 'ts', 'cs', 'ivproj'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'TypeScript', extensions: ['ts'] },
  { name: 'C#', extensions: ['cs'] },
  { name: 'IdeaBlade Validation Project', extensions: ['ivproj'] },
];

/** File → Open: asks for metadata files or a project, and returns each with its text (none when cancelled). */
ipcMain.handle('file:open', async (_e, title: string): Promise<ReadFile[]> => {
  const result = await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters: metadataFilters });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(async (p) => ({ path: p, text: await fs.readFile(p, 'utf8') })));
});

/** Reads a file by path; a TypeScript file comes with its models, validators and functions (typescript-models.ts). */
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
    : path.join(getLastSaveFolder(windowStateFile()) ?? projectDir ?? app.getPath('documents'), name);
  const result = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (result.canceled || !result.filePath) return undefined;
  setLastSaveFolder(windowStateFile(), path.dirname(result.filePath));
  return result.filePath;
});

// TypeScript metadata needs the TypeScript compiler, so the renderer asks for it here. These work on text only: the
// renderer reads and writes the file itself (file:read, file:save).

/** The metadata maps in a TS file's text, as JSON (or read-only, with the reason). */
ipcMain.handle('ts:read-metadata', (_e, text: string, fileName: string) => readTsMetadata(text, fileName));
/** The TS file's text with one map replaced by new JSON, the rest of the file kept. */
ipcMain.handle('ts:write-metadata', (_e, text: string, fileName: string, name: string, json: JsonObject) => writeTsMetadata(text, fileName, name, json));
/** The TS file's text with another map added at the end. */
ipcMain.handle('ts:insert-metadata', (_e, text: string, fileName: string, name: string, json: JsonObject) => insertTsMetadata(text, fileName, name, json));
/** The TS file's text without a map (and its doc comment). */
ipcMain.handle('ts:remove-metadata', (_e, text: string, fileName: string, name: string) => removeTsMetadata(text, fileName, name));
/** A new TS file's text holding one map (File → New → TypeScript). */
ipcMain.handle('ts:new-metadata', (_e, name: string, json: JsonObject) => newTsMetadataFile(name, json));

// The project file (*.ivproj, see project.ts): the renderer works with absolute paths.

/** The project a metadata file belongs to: the nearest *.ivproj in its folder or above. */
ipcMain.handle('project:find', (_e, filePath: string) => findProject(filePath));

/**
 * A project read or written (opened, found next to a metadata file, created) becomes the one to reopen next time and
 * the first in File → Open Recent Project (and in the taskbar's jump list). The menu is rebuilt only when the first
 * recent project changes.
 */
function projectUsed(usedPath: string): void {
  const projectPath = path.resolve(usedPath); // one way of writing each path (backslashes), so none is listed twice
  const before = getRecentProjects(windowStateFile())[0];
  setLastProject(windowStateFile(), projectPath);
  app.addRecentDocument(projectPath);
  if (before?.toLowerCase() !== projectPath.toLowerCase()) updateMenu();
}

// File → Close Project is there while a project is open; a closed one isn't reopened at the next start.
let projectOpen = false;
/** The renderer opened or closed a project: File → Close Project follows. */
ipcMain.on('project:open-state', (_e, open: boolean) => {
  if (projectOpen === !!open) return;
  projectOpen = !!open;
  updateMenu();
});
// File → Discard All Unsaved Changes is there while something is unsaved.
let hasUnsaved = false;
/** Something became unsaved, or everything saved: File → Discard All Unsaved Changes follows. */
ipcMain.on('app:unsaved-state', (_e, unsaved: boolean) => {
  if (hasUnsaved === !!unsaved) return;
  hasUnsaved = !!unsaved;
  updateMenu();
});
/** The user closed the project: the next start opens nothing (it stays in the recent list). */
ipcMain.on('project:closed', () => clearLastProject(windowStateFile()));
/** Reads a project with absolute paths and its patterns expanded, and makes it the recent one. */
ipcMain.handle('project:read', async (_e, projectPath: string) => {
  const project = await readProject(projectPath);
  projectUsed(projectPath);
  return project;
});
/** Writes a project (keeping keys the editor doesn't manage), returns it as read back, and makes it the recent one. */
ipcMain.handle('project:write', async (_e, projectPath: string, project: ProjectToWrite) => {
  const result = await writeProject(projectPath, project);
  projectUsed(projectPath);
  return result;
});

// Source patterns (a folder of DTOs: dir/**/*.{ts,cs}): the files each matches, and the folders they point at watched,
// so files appearing or disappearing there (a new DTO, a deleted entity) are sent to the renderer as the patterns'
// new lists of files. One set of patterns at a time, the editor's; called again when they change.

/** Patterns made absolute (relative ones to `baseDir`), each with the files it matches now. */
ipcMain.handle('sources:expand-patterns', (_e, patterns: string[], baseDir: string | undefined) => expandPatterns(patterns, baseDir));
/** Stops watching the previous patterns' folders, if any. */
let stopPatternWatch: (() => void) | undefined;
/**
 * Watches these patterns' folders instead of the previous ones (none for an empty list); changes go to the renderer
 * as `sources:pattern-matches`.
 */
ipcMain.handle('sources:watch-patterns', async (_e, patterns: string[] | undefined) => {
  stopPatternWatch?.();
  stopPatternWatch = undefined;
  if (!patterns?.length) return;
  try {
    stopPatternWatch = await watchPatterns(patterns, (matches) => win?.webContents.send('sources:pattern-matches', matches));
  } catch {
    // a folder that isn't there (yet): nothing to watch
  }
});
/** Add folder: a folder to take the sources from, starting in the project's folder; undefined when cancelled. */
ipcMain.handle('file:choose-source-folder', async (_e, defaultDir: string | undefined) => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Add a folder of model sources (TS and C# files, in it and its subfolders)',
    defaultPath: defaultDir,
    properties: ['openDirectory'],
  });
  return result.canceled ? undefined : result.filePaths[0];
});
/** Asks where to create a project file, in `defaultDir` (else Documents); the path always ends in .ivproj. */
ipcMain.handle('project:choose-path', async (_e, defaultDir: string | undefined) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Create a project file',
    // Named after its folder by default: temphire.angular -> temphire.angular.ivproj.
    defaultPath: path.join(defaultDir ?? app.getPath('documents'), projectFileName(path.basename(defaultDir ?? 'validation'))),
    filters: [{ name: 'IdeaBlade Validation Project', extensions: [PROJECT_EXTENSION.slice(1)] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  // The editor finds projects by their extension, so a project file always has it, whatever name was typed.
  return path.join(path.dirname(result.filePath), projectFileName(path.basename(result.filePath)));
});

/** A question with buttons (the first the default, the last the answer to Esc); returns the index of the one chosen. */
ipcMain.handle('app:confirm', async (_e, message: string, detail: string, buttons: string[]) => {
  const result = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return result.response;
});

/** The renderer agreed to close (after asking about unsaved changes): close for real. */
ipcMain.on('app:close', () => {
  forceClose = true;
  win.close();
});

// Model sources (Breeze metadata, TS and C# files) are watched, so the editor always offers the current models.

/** A watched source: its watcher (while the file is there) and the timer that waits for a save to settle. */
interface WatchedFile {
  watcher: FSWatcher | undefined;
  timer: NodeJS.Timeout | undefined;
}
const watchers = new Map<string, WatchedFile>(); // path -> { watcher, timer }

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
        win?.webContents.send('source:changed', withTypeScriptModels({ path: filePath, text }));
      } catch (e) {
        win?.webContents.send('source:changed', { path: filePath, error: String(e) });
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

/** File → Add source: asks for model sources and returns each read, with its models for TS (none when cancelled). */
ipcMain.handle('file:open-source', async (): Promise<ReadFile[]> => {
  const result = await dialog.showOpenDialog(win, {
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

/** The window's title, which the renderer keeps up to date (the open file or project, unsaved marker). */
ipcMain.on('app:set-title', (_e, title: string) => win.setTitle(title));

// What was selected in the sidebar, per project (or first metadata file), kept with the window's place.

/** The panes' widths as the user left them. */
ipcMain.handle('ui:get-layout', () => getLayout(windowStateFile()));
/** Saves the panes' widths (after a splitter is dragged). */
ipcMain.on('ui:set-layout', (_e, layout: PaneLayout) => setLayout(windowStateFile(), layout));
/** The sidebar selection saved for a workspace. */
ipcMain.handle('ui:get-selection', (_e, key: string) => getSelection(windowStateFile(), key));
/** Saves a workspace's sidebar selection. */
ipcMain.on('ui:set-selection', (_e, key: string, selection: SavedSelection) => setSelection(windowStateFile(), key, selection));
/** The folded files and maps saved for a workspace. */
ipcMain.handle('ui:get-folds', (_e, key: string) => getFolds(windowStateFile(), key));
/** Saves a workspace's folded files and maps. */
ipcMain.on('ui:set-folds', (_e, key: string, folds: SavedFolds) => setFolds(windowStateFile(), key, folds));

/** The renderer's theme setting (dark, light or system): the window frame, menus and dialogs follow it. */
ipcMain.on('app:set-theme', (_e, theme: string) => {
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' || theme === 'system' ? theme : 'dark';
  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f6f7f9');
});

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
    const last = getLastProject(windowStateFile());
    if (last) files.push(last);
  }
  return { files, sources };
});

/** A menu item's click: sends the command (and its argument) to the renderer, which does the work. */
function sendMenu(command: string, arg?: string): () => void {
  return () => win.webContents.send('menu', command, arg);
}

/** File → Open Recent Project: the recent projects, numbered (Alt+F, R, 1 opens the latest), and a way to clear them. */
function recentProjectsMenu(): MenuItemConstructorOptions[] {
  const recent = getRecentProjects(windowStateFile());
  if (!recent.length) return [{ label: 'No recent projects', enabled: false }];
  return [
    ...recent.map((projectPath, i) => ({
      // Windows menus read & as a mnemonic marker, so a path's own & is doubled.
      label: `${i < 9 ? `&${i + 1}` : i + 1}  ${projectPath.replace(/&/g, '&&')}`,
      click: () => win?.webContents.send('menu', 'openRecent', projectPath),
    })),
    { type: 'separator' },
    {
      label: '&Clear Recent Projects',
      click: () => {
        clearRecentProjects(windowStateFile());
        app.clearRecentDocuments();
        updateMenu();
      },
    },
  ];
}

/** Builds the menu again, for the current recent projects and state (project open, anything unsaved). */
function updateMenu(): void {
  Menu.setApplicationMenu(buildMenu());
  // The page shown when nothing is open lists them too.
  if (win && !win.isDestroyed()) win.webContents.send('recent-projects', getRecentProjects(windowStateFile()));
}

/** The recent projects, the latest first, for the page shown when nothing is open. */
ipcMain.handle('app:recent-projects', () => getRecentProjects(windowStateFile()));

/** The application menu: File (commands the renderer carries out), Electron's Edit menu, and View. */
const buildMenu = (): Menu => Menu.buildFromTemplate([
  {
    label: '&File',
    submenu: [
      {
        label: '&New',
        submenu: [
          { label: '&JSON', accelerator: 'CmdOrCtrl+N', click: sendMenu('new', 'json') },
          { label: '&TypeScript', click: sendMenu('new', 'ts') },
          { label: '&C#', click: sendMenu('new', 'cs') },
        ],
      },
      { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: sendMenu('open') },
      { label: 'Open &Recent Project', submenu: recentProjectsMenu() },
      { label: 'Close &Project', enabled: projectOpen, click: sendMenu('closeProject') },
      { type: 'separator' },
      { label: '&Save', accelerator: 'CmdOrCtrl+S', click: sendMenu('save') },
      { label: 'Save &As…', accelerator: 'CmdOrCtrl+Shift+S', click: sendMenu('saveAs') },
      { label: 'Save A&ll', accelerator: 'CmdOrCtrl+Alt+S', click: sendMenu('saveAll') },
      { label: 'Discard All &Unsaved Changes…', enabled: hasUnsaved, click: sendMenu('discardAll') },
      { type: 'separator' },
      { label: 'Add &source (Breeze, TS, C#)…', accelerator: 'CmdOrCtrl+M', click: sendMenu('addSource') },
      { label: 'Add source &folder…', accelerator: 'CmdOrCtrl+Shift+M', click: sendMenu('addSourceFolder') },
      { label: 'Reloa&d model sources', accelerator: 'F5', click: sendMenu('reloadSources') },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'editMenu' },
  {
    // Electron's View menu, plus Reset Layout (the splitters' widths back to their defaults).
    label: '&View',
    submenu: [
      { label: '&Find Model Type or Map…', accelerator: 'CmdOrCtrl+Shift+F', click: sendMenu('findInSidebar') },
      { label: 'Reset &Layout', click: sendMenu('resetLayout') },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
]);

void app.whenReady().then(() => {
  updateMenu();
  createWindow();
});

// One window: closing it ends the app, on macOS too.
app.on('window-all-closed', () => app.quit());
