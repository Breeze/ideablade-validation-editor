// The renderer's only access to the system: open/save JSON files and a few window functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorHost', {
  openFile: (title) => ipcRenderer.invoke('file:open', title),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', path, text),
  saveFileAs: (defaultPath, text) => ipcRenderer.invoke('file:saveAs', defaultPath, text),
  confirm: (message, detail, buttons) => ipcRenderer.invoke('app:confirm', message, detail, buttons),
  openSources: () => ipcRenderer.invoke('file:open-source'),
  watchSources: (paths) => ipcRenderer.invoke('sources:watch', paths),
  onSourceChanged: (handler) => {
    const listener = (_e, change) => handler(change);
    ipcRenderer.on('source:changed', listener);
    return () => ipcRenderer.removeListener('source:changed', listener);
  },
  startupArgs: () => ipcRenderer.invoke('app:startup-args'),  setTitle: (title) => ipcRenderer.send('app:set-title', title),
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
