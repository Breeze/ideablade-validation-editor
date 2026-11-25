// Electron main process: one window, plus file dialogs and file I/O for the renderer (see preload.cjs).
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withTypeScriptModels } = require('./typescript-models.cjs');
const { readTsMetadata, writeTsMetadata, insertTsMetadata, removeTsMetadata, newTsMetadataFile } = require('./typescript-metadata.cjs');
const { PROJECT_EXTENSION, projectFileName, findProject, readProject, writeProject, expandPatterns, watchPatterns } = require('./project.cjs');
const {
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
} = require('./window-state.cjs');

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
    // The packaged exe has it built in; running from source (electron .) needs it here, or Electron's own shows.
    // (Windows takes the .ico, with its small sizes; Linux a PNG. macOS uses the app bundle's.)
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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

/**
 * Asks where to save; the format follows the extension chosen. The renderer writes the file. A file that has a path
 * starts next to it; a new one (just a name) in the folder last chosen here, else the open project's, else Documents.
 */
ipcMain.handle('file:choose-save-path', async (_e, suggestion, projectDir) => {
  const filters = metadataFilters.slice(1, 4); // the metadata formats
  const ext = path.extname(suggestion ?? '').slice(1).toLowerCase();
  filters.sort((a, b) => (b.extensions[0] === ext) - (a.extensions[0] === ext)); // the current format first
  const name = suggestion ?? 'validation.metadata.json';
  const defaultPath = path.isAbsolute(name)
    ? name
    : path.join(getLastSaveFolder(windowStateFile()) ?? projectDir ?? app.getPath('documents'), name);
  const result = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (result.canceled || !result.filePath) return undefined;
  setLastSaveFolder(windowStateFile(), path.dirname(result.filePath));
  return result.filePath;
});

// TypeScript metadata needs the TypeScript compiler, so the renderer asks for it here. These work on text only.
ipcMain.handle('ts:read-metadata', (_e, text, fileName) => readTsMetadata(text, fileName));
ipcMain.handle('ts:write-metadata', (_e, text, fileName, name, json) => writeTsMetadata(text, fileName, name, json));
ipcMain.handle('ts:insert-metadata', (_e, text, fileName, name, json) => insertTsMetadata(text, fileName, name, json));
ipcMain.handle('ts:remove-metadata', (_e, text, fileName, name) => removeTsMetadata(text, fileName, name));
ipcMain.handle('ts:new-metadata', (_e, name, json) => newTsMetadataFile(name, json));

// The project file (*.ivproj, see project.cjs): the renderer works with absolute paths.
ipcMain.handle('project:find', (_e, filePath) => findProject(filePath));
// A project read or written (opened, found next to a metadata file, created) becomes the one to reopen next time and
// the first in File → Open Recent Project (and in the taskbar's jump list).
function projectUsed(usedPath) {
  const projectPath = path.resolve(usedPath); // one way of writing each path (backslashes), so none is listed twice
  const before = getRecentProjects(windowStateFile())[0];
  setLastProject(windowStateFile(), projectPath);
  app.addRecentDocument(projectPath);
  if (before?.toLowerCase() !== projectPath.toLowerCase()) updateMenu();
}
// File → Close Project is there while a project is open; a closed one isn't reopened at the next start.
let projectOpen = false;
ipcMain.on('project:open-state', (_e, open) => {
  if (projectOpen === !!open) return;
  projectOpen = !!open;
  updateMenu();
});
// File → Discard All Unsaved Changes is there while something is unsaved.
let hasUnsaved = false;
ipcMain.on('app:unsaved-state', (_e, unsaved) => {
  if (hasUnsaved === !!unsaved) return;
  hasUnsaved = !!unsaved;
  updateMenu();
});
ipcMain.on('project:closed', () => clearLastProject(windowStateFile()));
ipcMain.handle('project:read', async (_e, projectPath) => {
  const project = await readProject(projectPath);
  projectUsed(projectPath);
  return project;
});
ipcMain.handle('project:write', async (_e, projectPath, project) => {
  const result = await writeProject(projectPath, project);
  projectUsed(projectPath);
  return result;
});

// Source patterns (a folder of DTOs: dir/**/*.{ts,cs}): the files each matches, and the folders they point at watched,
// so files appearing or disappearing there (a new DTO, a deleted entity) are sent to the renderer as the patterns'
// new lists of files. One set of patterns at a time, the editor's; called again when they change.
ipcMain.handle('sources:expand-patterns', (_e, patterns, baseDir) => expandPatterns(patterns, baseDir));
let stopPatternWatch;
ipcMain.handle('sources:watch-patterns', async (_e, patterns) => {
  stopPatternWatch?.();
  stopPatternWatch = undefined;
  if (!patterns?.length) return;
  try {
    stopPatternWatch = await watchPatterns(patterns, (matches) => win?.webContents.send('sources:pattern-matches', matches));
  } catch {
    // a folder that isn't there (yet): nothing to watch
  }
});
// Add folder: a folder to take the sources from, starting in the project's folder.
ipcMain.handle('file:choose-source-folder', async (_e, defaultDir) => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Add a folder of model sources (TS and C# files, in it and its subfolders)',
    defaultPath: defaultDir,
    properties: ['openDirectory'],
  });
  return result.canceled ? undefined : result.filePaths[0];
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
ipcMain.handle('ui:get-layout', () => getLayout(windowStateFile()));
ipcMain.on('ui:set-layout', (_e, layout) => setLayout(windowStateFile(), layout));
ipcMain.handle('ui:get-selection', (_e, key) => getSelection(windowStateFile(), key));
ipcMain.on('ui:set-selection', (_e, key, selection) => setSelection(windowStateFile(), key, selection));
ipcMain.handle('ui:get-folds', (_e, key) => getFolds(windowStateFile(), key));
ipcMain.on('ui:set-folds', (_e, key, folds) => setFolds(windowStateFile(), key, folds));

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
  // Without files to open, the project used last, if it's still there.
  if (!files.length && !sources.length) {
    const last = getLastProject(windowStateFile());
    if (last) files.push(last);
  }
  return { files, sources };
});
function sendMenu(command, arg) {
  return () => win.webContents.send('menu', command, arg);
}

/** File → Open Recent Project: the recent projects, numbered (Alt+F, R, 1 opens the latest), and a way to clear them. */
function recentProjectsMenu() {
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

/** Builds the menu again, for the current recent projects. */
function updateMenu() {
  Menu.setApplicationMenu(buildMenu());
  // The page shown when nothing is open lists them too.
  if (win && !win.isDestroyed()) win.webContents.send('recent-projects', getRecentProjects(windowStateFile()));
}
ipcMain.handle('app:recent-projects', () => getRecentProjects(windowStateFile()));

const buildMenu = () => Menu.buildFromTemplate([
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

app.whenReady().then(() => {
  updateMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
