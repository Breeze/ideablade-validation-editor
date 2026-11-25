// Electron main process, the entry point: one window, its menu, and everything the renderer can't do itself, as IPC
// handlers. The renderer reaches those through the preload script (preload.ts, `window.editorHost`; its interface is
// EditorHost in src/app/services/host.ts). Each `ipcMain.handle` answers an `invoke` (the renderer awaits the result);
// each `ipcMain.on` takes a `send` that needs no answer.
//
// Where everything lives:
//   main.ts                 this file: app lifecycle, and registering the IPC handlers below
//   preload.ts              `window.editorHost`, the renderer's side of every channel
//   types.ts                the payloads that cross IPC, shared by the files below and preload.ts
//   paths.ts                where preload.js, dist/index.html and the icons are at run time
//   window/main-window.ts   the window: creating it, closing via the renderer; app:set-title, app:set-theme,
//                           app:confirm, app:close
//   window/menu.ts          the application menu and the state it follows: project:open-state, app:unsaved-state
//   ipc/files.ts            file:*: open, read, save, Save As, add sources or a folder of them
//   ipc/typescript.ts       ts:*: metadata maps in TypeScript files (typescript/metadata-read.ts, metadata-write.ts)
//   ipc/project.ts          project:*: the *.ivproj file (project/project-file.ts), and the recent projects
//   ipc/sources.ts          sources:*: source patterns (project/source-patterns.ts) and watching source files
//   ipc/settings.ts         ui:*, app:recent-projects, app:startup-args: the user's settings (settings/)
//   ipc/updates.ts          updates:*: the update settings and status, installing an update, release pages
//   settings/               the settings file (window-state.json): window bounds, recent projects, user settings
//   typescript/             reading TS files with the compiler: metadata maps, models, the app's validators
//   updates/                updates from the GitHub releases: checking, downloading, installing (updater.ts)
//
// This file is compiled to dist-electron/main.js (package.json's "main"), next to preload.js; the Angular app is in
// dist/ and the icons in build/, both one folder up from it, in the source tree and in the packaged app alike.
import { app } from 'electron';
import { registerFileHandlers } from './ipc/files';
import { registerProjectHandlers } from './ipc/project';
import { registerSettingsHandlers } from './ipc/settings';
import { registerSourceHandlers } from './ipc/sources';
import { registerTypeScriptHandlers } from './ipc/typescript';
import { registerUpdateHandlers } from './ipc/updates';
import { scheduleUpdateChecks } from './updates/updater';
import { createWindow, registerWindowHandlers } from './window/main-window';
import { registerMenuHandlers, updateMenu } from './window/menu';

// The handlers are registered right away; they only run once the window has loaded the renderer.
registerFileHandlers();
registerTypeScriptHandlers();
registerProjectHandlers();
registerSourceHandlers();
registerSettingsHandlers();
registerWindowHandlers();
registerMenuHandlers();
registerUpdateHandlers();

void app.whenReady().then(() => {
  updateMenu();
  createWindow();
  // Checks for updates a few seconds from now and every 4 hours, if this copy gets them and the setting is on.
  scheduleUpdateChecks();
});

// One window: closing it ends the app, on macOS too.
app.on('window-all-closed', () => app.quit());
