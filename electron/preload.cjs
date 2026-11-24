// The renderer's only access to the system: opening and saving files, reading TypeScript, and a few window functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorHost', {
  openFile: (title) => ipcRenderer.invoke('file:open', title),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', path, text),
  chooseSavePath: (defaultPath) => ipcRenderer.invoke('file:choose-save-path', defaultPath),
  readTsMetadata: (text, fileName) => ipcRenderer.invoke('ts:read-metadata', text, fileName),
  writeTsMetadata: (text, fileName, name, json) => ipcRenderer.invoke('ts:write-metadata', text, fileName, name, json),
  newTsMetadata: (name, json) => ipcRenderer.invoke('ts:new-metadata', name, json),
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
  close: () => ipcRenderer.send('app:close'),
  onMenu: (handler) => {
    const listener = (_e, command) => handler(command);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
  onCloseRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
});
