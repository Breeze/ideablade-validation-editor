// The renderer's only access to the system: opening and saving files, reading TypeScript, and a few window functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorHost', {
  openFile: (title) => ipcRenderer.invoke('file:open', title),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', path, text),
  chooseSavePath: (suggestion, projectDir) => ipcRenderer.invoke('file:choose-save-path', suggestion, projectDir),
  readTsMetadata: (text, fileName) => ipcRenderer.invoke('ts:read-metadata', text, fileName),
  writeTsMetadata: (text, fileName, name, json) => ipcRenderer.invoke('ts:write-metadata', text, fileName, name, json),
  insertTsMetadata: (text, fileName, name, json) => ipcRenderer.invoke('ts:insert-metadata', text, fileName, name, json),
  removeTsMetadata: (text, fileName, name) => ipcRenderer.invoke('ts:remove-metadata', text, fileName, name),
  newTsMetadata: (name, json) => ipcRenderer.invoke('ts:new-metadata', name, json),
  findProject: (filePath) => ipcRenderer.invoke('project:find', filePath),
  readProject: (projectPath) => ipcRenderer.invoke('project:read', projectPath),
  writeProject: (projectPath, project) => ipcRenderer.invoke('project:write', projectPath, project),
  chooseProjectPath: (defaultDir) => ipcRenderer.invoke('project:choose-path', defaultDir),
  watchProject: (projectPath) => ipcRenderer.invoke('project:watch', projectPath),
  onProjectFilesChanged: (handler) => {
    const listener = (_e, change) => handler(change);
    ipcRenderer.on('project:files-changed', listener);
    return () => ipcRenderer.removeListener('project:files-changed', listener);
  },
  confirm: (message, detail, buttons) => ipcRenderer.invoke('app:confirm', message, detail, buttons),
  openSources: () => ipcRenderer.invoke('file:open-source'),
  watchSources: (paths) => ipcRenderer.invoke('sources:watch', paths),
  onSourceChanged: (handler) => {
    const listener = (_e, change) => handler(change);
    ipcRenderer.on('source:changed', listener);
    return () => ipcRenderer.removeListener('source:changed', listener);
  },
  startupArgs: () => ipcRenderer.invoke('app:startup-args'),
  setTitle: (title) => ipcRenderer.send('app:set-title', title),
  setTheme: (theme) => ipcRenderer.send('app:set-theme', theme),
  getSelection: (key) => ipcRenderer.invoke('ui:get-selection', key),
  saveSelection: (key, selection) => ipcRenderer.send('ui:set-selection', key, selection),
  getLayout: () => ipcRenderer.invoke('ui:get-layout'),
  saveLayout: (layout) => ipcRenderer.send('ui:set-layout', layout),
  setProjectOpen: (open) => ipcRenderer.send('project:open-state', open),
  projectClosed: () => ipcRenderer.send('project:closed'),
  close: () => ipcRenderer.send('app:close'),
  onMenu: (handler) => {
    const listener = (_e, command, arg) => handler(command, arg);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
  onCloseRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
});
