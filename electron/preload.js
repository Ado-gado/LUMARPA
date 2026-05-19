'use strict';

// Preload пока пустой — UI общается с Express по HTTP через fetch.
// Файл оставлен на будущее (для безопасного IPC, если понадобится).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  apiPort: process.env.API_PORT || '3001',
});
