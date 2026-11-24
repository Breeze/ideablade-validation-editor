// Electron main process: one window, plus file dialogs and file I/O for the renderer (see preload.cjs).
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withTypeScriptModels } = require('./typescript-models.cjs');

let win;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'IdeaBlade Validation Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

const jsonFilters = [
  { name: 'JSON', extensions: ['json'] },
  { name: 'All files', extensions: ['*'] },
];

ipcMain.handle('file:open', async (_e, title) => {
  const result = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters: jsonFilters });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  const filePath = result.filePaths[0];
  return { path: filePath, text: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('file:read', async (_e, filePath) => withTypeScriptModels({ path: filePath, text: await fs.readFile(filePath, 'utf8') }));

ipcMain.handle('file:save', async (_e, filePath, text) => {
  await fs.writeFile(filePath, text, 'utf8');
  return filePath;
});

ipcMain.handle('file:saveAs', async (_e, defaultPath, text) => {
  const result = await dialog.showSaveDialog(win, { defaultPath, filters: jsonFilters });
  if (result.canceled || !result.filePath) return undefined;
  await fs.writeFile(result.filePath, text, 'utf8');
  return result.filePath;
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

// A file passed on the command line (e.g. through the "Open with" file association).
// Command line: a metadata file to open, and model sources to load with it:
//   electron . validation.metadata.json --source=breeze-metadata.json --source=src/app/view-models.ts
// Relative paths are resolved against the working directory.
ipcMain.handle('app:startup-args', () => {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const file = args.find((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.json'));
  const sources = args.filter((a) => a.startsWith('--source=')).map((a) => path.resolve(a.slice('--source='.length)));
  return { file: file ? path.resolve(file) : undefined, sources };
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
