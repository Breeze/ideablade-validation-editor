// The preload script: the renderer's only access to the system. It runs in the renderer before the page, sandboxed,
// and exposes `window.editorHost` (src/app/services/host.ts, interface EditorHost) through the context bridge:
// opening and saving files, reading TypeScript, the project file, the user's settings and a few window functions. Each
// function is a message to the main process (main.ts), `invoke` for those that answer and `send` for those that don't; the
// `on…` functions subscribe to the main process's messages and return a function that unsubscribes.
//
// Sandboxed preloads can require only 'electron' and a few Node built-ins, not other files: the imports of the
// payloads' types below are type-only, so they compile to nothing.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PatternMatch, ProjectToWrite } from './project';
import type { JsonObject } from './typescript-metadata';
import type { ReadFile } from './typescript-models';
import type { PaneLayout, SavedFolds, SavedSelection } from './window-state';

/** Subscribes `handler` to a message from the main process; returns a function that unsubscribes it. */
function subscribe<A extends unknown[]>(channel: string, handler: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => handler(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('editorHost', {
  // Files: the metadata files and sources the editor opens, reads and saves.
  openFile: (title: string) => ipcRenderer.invoke('file:open', title),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  saveFile: (path: string, text: string) => ipcRenderer.invoke('file:save', path, text),
  chooseSavePath: (suggestion: string, projectDir?: string) => ipcRenderer.invoke('file:choose-save-path', suggestion, projectDir),

  // Metadata in TypeScript files, which needs the TypeScript compiler (typescript-metadata.ts).
  readTsMetadata: (text: string, fileName: string) => ipcRenderer.invoke('ts:read-metadata', text, fileName),
  writeTsMetadata: (text: string, fileName: string, name: string, json: JsonObject) =>
    ipcRenderer.invoke('ts:write-metadata', text, fileName, name, json),
  insertTsMetadata: (text: string, fileName: string, name: string, json: JsonObject) =>
    ipcRenderer.invoke('ts:insert-metadata', text, fileName, name, json),
  removeTsMetadata: (text: string, fileName: string, name: string) => ipcRenderer.invoke('ts:remove-metadata', text, fileName, name),
  newTsMetadata: (name: string, json: JsonObject) => ipcRenderer.invoke('ts:new-metadata', name, json),

  // The project file (*.ivproj, project.ts) and source patterns.
  findProject: (filePath: string) => ipcRenderer.invoke('project:find', filePath),
  readProject: (projectPath: string) => ipcRenderer.invoke('project:read', projectPath),
  writeProject: (projectPath: string, project: ProjectToWrite) => ipcRenderer.invoke('project:write', projectPath, project),
  chooseProjectPath: (defaultDir?: string) => ipcRenderer.invoke('project:choose-path', defaultDir),
  expandPatterns: (patterns: string[], baseDir?: string) => ipcRenderer.invoke('sources:expand-patterns', patterns, baseDir),
  watchPatterns: (patterns: string[]) => ipcRenderer.invoke('sources:watch-patterns', patterns),
  onPatternMatches: (handler: (matches: PatternMatch[]) => void) => subscribe('sources:pattern-matches', handler),
  chooseSourceFolder: (defaultDir?: string) => ipcRenderer.invoke('file:choose-source-folder', defaultDir),

  // Dialogs and model sources.
  confirm: (message: string, detail: string, buttons: string[]) => ipcRenderer.invoke('app:confirm', message, detail, buttons),
  openSources: () => ipcRenderer.invoke('file:open-source'),
  watchSources: (paths: string[]) => ipcRenderer.invoke('sources:watch', paths),
  onSourceChanged: (handler: (change: ReadFile) => void) => subscribe('source:changed', handler),

  // The window and the app.
  startupArgs: () => ipcRenderer.invoke('app:startup-args'),
  setTitle: (title: string) => ipcRenderer.send('app:set-title', title),
  setTheme: (theme: string) => ipcRenderer.send('app:set-theme', theme),

  // The user's settings, kept with the window's place (window-state.ts).
  getSelection: (key: string) => ipcRenderer.invoke('ui:get-selection', key),
  saveSelection: (key: string, selection: SavedSelection) => ipcRenderer.send('ui:set-selection', key, selection),
  getFolds: (key: string) => ipcRenderer.invoke('ui:get-folds', key),
  saveFolds: (key: string, folds: SavedFolds) => ipcRenderer.send('ui:set-folds', key, folds),
  getLayout: () => ipcRenderer.invoke('ui:get-layout'),
  saveLayout: (layout: PaneLayout) => ipcRenderer.send('ui:set-layout', layout),

  // State the menu follows (File → Close Project, Discard All Unsaved Changes), and closing.
  setProjectOpen: (open: boolean) => ipcRenderer.send('project:open-state', open),
  setUnsaved: (unsaved: boolean) => ipcRenderer.send('app:unsaved-state', unsaved),
  projectClosed: () => ipcRenderer.send('project:closed'),
  close: () => ipcRenderer.send('app:close'),
  getRecentProjects: () => ipcRenderer.invoke('app:recent-projects'),
  onRecentProjects: (handler: (paths: string[]) => void) => subscribe('recent-projects', handler),
  onMenu: (handler: (command: string, arg?: string) => void) => subscribe('menu', handler),
  onCloseRequested: (handler: () => void) => subscribe('app:close-requested', () => handler()),
});
