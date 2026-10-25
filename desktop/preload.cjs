const { contextBridge, ipcRenderer } = require('electron');

// Only what the UI needs from the desktop shell: a native folder picker for
// adding music folders. Resolves to a path, or undefined if cancelled.
contextBridge.exposeInMainWorld('hifi', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
