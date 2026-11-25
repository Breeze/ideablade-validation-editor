// The application menu: File (commands the renderer carries out), Electron's Edit menu, and View. A menu item doesn't
// do the work itself: it sends the command to the renderer as a `menu` message (preload.ts, onMenu).
//
// Some items follow the renderer's state, which it reports here (registerMenuHandlers): File → Close Project while a
// project is open, Discard All Unsaved Changes while something is unsaved. File → Open Recent Project lists the
// recent projects (settings/recent-projects.ts). Whenever any of that changes, updateMenu builds the menu again;
// ipc/project.ts calls it when a project is used.
import { app, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { clearRecentProjects, getRecentProjects } from '../settings/recent-projects';
import { settingsFilePath } from '../settings/settings-file';
import { mainWindow } from './main-window';

// File → Close Project is there while a project is open; a closed one isn't reopened at the next start.
let projectOpen = false;
// File → Discard All Unsaved Changes is there while something is unsaved.
let hasUnsaved = false;

/** Registers the handlers for the state the menu follows: a project open, anything unsaved. */
export function registerMenuHandlers(): void {
  /** The renderer opened or closed a project: File → Close Project follows. */
  ipcMain.on('project:open-state', (_e, open: boolean) => {
    if (projectOpen === !!open) return;
    projectOpen = !!open;
    updateMenu();
  });

  /** Something became unsaved, or everything saved: File → Discard All Unsaved Changes follows. */
  ipcMain.on('app:unsaved-state', (_e, unsaved: boolean) => {
    if (hasUnsaved === !!unsaved) return;
    hasUnsaved = !!unsaved;
    updateMenu();
  });
}

/**
 * Builds the menu again, for the current recent projects and state (project open, anything unsaved). Also called
 * once at startup, before the window exists.
 */
export function updateMenu(): void {
  Menu.setApplicationMenu(buildMenu());
  // The page shown when nothing is open lists them too.
  const win = mainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('recent-projects', getRecentProjects(settingsFilePath()));
}

/** A menu item's click: sends the command (and its argument) to the renderer, which does the work. */
function sendMenu(command: string, arg?: string): () => void {
  return () => mainWindow().webContents.send('menu', command, arg);
}

/** File → Open Recent Project: the recent projects, numbered (Alt+F, R, 1 opens the latest), and a way to clear them. */
function recentProjectsMenu(): MenuItemConstructorOptions[] {
  const recent = getRecentProjects(settingsFilePath());
  if (!recent.length) return [{ label: 'No recent projects', enabled: false }];
  return [
    ...recent.map((projectPath, i) => ({
      // Windows menus read & as a mnemonic marker, so a path's own & is doubled.
      label: `${i < 9 ? `&${i + 1}` : i + 1}  ${projectPath.replace(/&/g, '&&')}`,
      click: () => mainWindow()?.webContents.send('menu', 'openRecent', projectPath),
    })),
    { type: 'separator' },
    {
      label: '&Clear Recent Projects',
      click: () => {
        clearRecentProjects(settingsFilePath());
        app.clearRecentDocuments();
        updateMenu();
      },
    },
  ];
}

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
