'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  apiPort: process.env.API_PORT || '3001',
  // Диалог выбора папки
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
