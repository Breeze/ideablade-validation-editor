// The editor's one window: creating it where it was last closed, loading the renderer, and closing it only once the
// renderer has agreed (it asks about unsaved changes first). Also the handlers that act on the window itself: its
// title, the colour theme, the question dialog, and closing for real.
//
// main.ts creates the window once the app is ready; everything else reaches it through mainWindow(). The IPC handlers
// only run after that, but the menu is first built before it (menu.ts checks).
import { BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron';
import { preloadPath, rendererIndexPath, windowIconPath } from '../paths';
import { settingsFilePath } from '../settings/settings-file';
import { loadWindowState, trackWindowState } from '../settings/window-bounds';

/** The one window, created once the app is ready; the handlers only run after that. */
let win!: BrowserWindow;
/** Set once the renderer has agreed to close (nothing unsaved, or the user said so): the next close goes through. */
let forceClose = false;

/**
 * The editor's window, for dialogs and for messages to the renderer. Undefined only before createWindow, which is
 * why code that may run that early (the menu, file watchers) checks it.
 */
export function mainWindow(): BrowserWindow {
  return win;
}

/**
 * Creates the window where it was last closed, loads the renderer (the dev server's URL under `npm run dev`, else the
 * built Angular app in dist/), and routes closing through the renderer so it can ask about unsaved changes.
 */
export function createWindow(): void {
  // The size and position it had when it was last closed (settings/window-bounds.ts).
  const stateFile = settingsFilePath();
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
    icon: windowIconPath, // needed when running from source (paths.ts)
    webPreferences: {
      preload: preloadPath, // dist-electron/preload.js
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
    void win.loadFile(rendererIndexPath);
  }

  // Ask the renderer whether there are unsaved changes before closing.
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });
}

/** Registers the handlers for the window itself: title, theme, the question dialog, and closing. */
export function registerWindowHandlers(): void {
  /** The window's title, which the renderer keeps up to date (the open file or project, unsaved marker). */
  ipcMain.on('app:set-title', (_e, title: string) => win.setTitle(title));

  /** The renderer's theme setting (dark, light or system): the window frame, menus and dialogs follow it. */
  ipcMain.on('app:set-theme', (_e, theme: string) => {
    nativeTheme.themeSource = theme === 'dark' || theme === 'light' || theme === 'system' ? theme : 'dark';
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f6f7f9');
  });

  /**
   * A question with buttons (the first the default, the last the answer to Esc); returns the index of the one chosen.
   */
  ipcMain.handle('app:confirm', async (_e, message: string, detail: string, buttons: string[]) => {
    const result = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
    return result.response;
  });

  /** The renderer agreed to close (after asking about unsaved changes): close for real. */
  ipcMain.on('app:close', () => {
    forceClose = true;
    win.close();
  });
}
