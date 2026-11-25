// Electron main process: one window, plus file dialogs and file I/O for the renderer (see preload.cjs).
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withTypeScriptModels } = require('./typescript-models.cjs');
const { readTsMetadata, writeTsMetadata, newTsMetadataFile } = require('./typescript-metadata.cjs');
const { PROJECT_EXTENSION, projectFileName, findProject, readProject, writeProject, watchProjectFolders } = require('./project.cjs');
const { loadWindowState, trackWindowState, getSelection, setSelection } = require('./window-state.cjs');

let win;
let forceClose = false;

/** The window's place and the sidebar selections, a user's settings (window-state.cjs). */
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function createWindow() {
  // The size and position it had when it was last closed (window-state.cjs).
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  trackWindowState(win, stateFile);

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Ask the renderer whether there are unsaved changes before closing.
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });
}

// Validation metadata lives in JSON files, or in TypeScript and C# files (see typescript-metadata.cjs and
// src/lib/cs-metadata.ts).
const metadataFilters = [
  { name: 'Validation metadata and projects', extensions: ['json', 'ts', 'cs', 'ivproj'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'TypeScript', extensions: ['ts'] },
  { name: 'C#', extensions: ['cs'] },
  { name: 'IdeaBlade Validation Project', extensions: ['ivproj'] },
];

ipcMain.handle('file:open', async (_e, title) => {
  const result = await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters: metadataFilters });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(async (p) => ({ path: p, text: await fs.readFile(p, 'utf8') })));
});

ipcMain.handle('file:read', async (_e, filePath) => withTypeScriptModels({ path: filePath, text: await fs.readFile(filePath, 'utf8') }));

ipcMain.handle('file:save', async (_e, filePath, text) => {
  await fs.writeFile(filePath, text, 'utf8');
  return filePath;
});

/** Asks where to save; the format follows the extension chosen. The renderer writes the file. */
ipcMain.handle('file:choose-save-path', async (_e, defaultPath) => {
  const filters = metadataFilters.slice(1, 4); // the metadata formats
  const ext = path.extname(defaultPath ?? '').slice(1).toLowerCase();
  filters.sort((a, b) => (b.extensions[0] === ext) - (a.extensions[0] === ext)); // the current format first
  const result = await dialog.showSaveDialog(win, { defaultPath, filters });
  return result.canceled ? undefined : result.filePath;
});

// TypeScript metadata needs the TypeScript compiler, so the renderer asks for it here. These work on text only.
ipcMain.handle('ts:read-metadata', (_e, text, fileName) => readTsMetadata(text, fileName));
ipcMain.handle('ts:write-metadata', (_e, text, fileName, name, json) => writeTsMetadata(text, fileName, name, json));
ipcMain.handle('ts:new-metadata', (_e, name, json) => newTsMetadataFile(name, json));

// The project file (*.ivproj, see project.cjs): the renderer works with absolute paths.
ipcMain.handle('project:find', (_e, filePath) => findProject(filePath));
ipcMain.handle('project:read', (_e, projectPath) => readProject(projectPath));
ipcMain.handle('project:write', (_e, projectPath, project) => writeProject(projectPath, project));

// The folders the project's patterns point at: files appearing or disappearing there (a new DTO, a deleted entity)
// are sent to the renderer as the patterns' new list of files. One project at a time; called again when it changes.
let stopProjectWatch;
ipcMain.handle('project:watch', async (_e, projectPath) => {
  stopProjectWatch?.();
  stopProjectWatch = undefined;
  if (!projectPath) return;
  try {
    stopProjectWatch = await watchProjectFolders(projectPath, (sourceFiles) => win?.webContents.send('project:files-changed', { path: projectPath, sourceFiles }));
  } catch {
    // the project doesn't read: the renderer has reported that already
  }
});
ipcMain.handle('project:choose-path', async (_e, defaultDir) => {
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

ipcMain.handle('app:confirm', async (_e, message, detail, buttons) => {
  const result = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return result.response;
});

ipcMain.on('app:close', () => {
  forceClose = true;
  win.close();
});

// Model sources (Breeze metadata, TS and C# files) are watched, so the editor always offers the current models.
const watchers = new Map(); // path -> { watcher, timer }
const fsSync = require('node:fs');

function watchFile(filePath) {
  const entry = { watcher: undefined, timer: undefined };
  const fire = () => {
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
  const rewatch = () => {
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

ipcMain.handle('sources:watch', (_e, paths) => {
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

ipcMain.handle('file:open-source', async () => {
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

ipcMain.on('app:set-title', (_e, title) => win.setTitle(title));

// What was selected in the sidebar, per project (or first metadata file), kept with the window's place.
ipcMain.handle('ui:get-selection', (_e, key) => getSelection(windowStateFile(), key));
ipcMain.on('ui:set-selection', (_e, key, selection) => setSelection(windowStateFile(), key, selection));

// The renderer's theme setting (dark, light or system): the window frame, menus and dialogs follow it.
ipcMain.on('app:set-theme', (_e, theme) => {
  nativeTheme.themeSource = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f6f7f9');
});

// A file passed on the command line (e.g. through the "Open with" file association).
// Command line: a project (*.ivproj), or metadata files to open (JSON, TS or C#) and sources to load with them:
//   electron . temphire.ivproj
//   electron . validation.metadata.json client-validation-metadata.ts --source=breeze-metadata.json --source=src/app/view-models.ts
// Relative paths are resolved against the working directory.
ipcMain.handle('app:startup-args', () => {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const files = args.filter((a) => !a.startsWith('-') && /\.(json|ts|cs|ivproj)$/i.test(a)).map((a) => path.resolve(a));
  const sources = args.filter((a) => a.startsWith('--source=')).map((a) => path.resolve(a.slice('--source='.length)));
  return { files, sources };
});
function sendMenu(command) {
  return () => win.webContents.send('menu', command);
}

const menu = Menu.buildFromTemplate([
  {
    label: '&File',
    submenu: [
      { label: '&New', accelerator: 'CmdOrCtrl+N', click: sendMenu('new') },
      { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: sendMenu('open') },
      { label: '&Save', accelerator: 'CmdOrCtrl+S', click: sendMenu('save') },
      { label: 'Save &As…', accelerator: 'CmdOrCtrl+Shift+S', click: sendMenu('saveAs') },
      { label: 'Save A&ll', accelerator: 'CmdOrCtrl+Alt+S', click: sendMenu('saveAll') },
      { label: '&Close document', accelerator: 'CmdOrCtrl+W', click: sendMenu('close') },
      { type: 'separator' },
      { label: 'Add &source (Breeze, TS, C#)…', accelerator: 'CmdOrCtrl+M', click: sendMenu('addSource') },
      { label: '&Reload model sources', accelerator: 'F5', click: sendMenu('reloadSources') },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'editMenu' },
  { role: 'viewMenu' },
]);

app.whenReady().then(() => {
  Menu.setApplicationMenu(menu);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
