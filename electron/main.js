'use strict';

/**
 * Electron main process для Luma Registration Bot.
 *
 * Что делает:
 *  1. При старте — запускает Express API (src/api.js) как in-process require()
 *     (без spawn — чтобы избежать проблем с поиском node.exe внутри установленного приложения).
 *  2. Express отдаёт собранный React UI из src/ui/dist (см. api.js).
 *  3. Открывает BrowserWindow, грузит http://127.0.0.1:3001.
 *  4. Tray-иконка: закрытие окна сворачивает в трей, выход — через меню трея.
 */

const path        = require('path');
const fs          = require('fs');
const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');

// Скрываем консольное окно на Windows (если запущено через .exe — это уже делает GUI subsystem)
app.commandLine.appendSwitch('disable-features', 'AutofillAddressPolling');

// Пути:
// - в dev: __dirname === <repo>/electron, src/api.js рядом
// - в prod (asar): __dirname === <resources>/app/electron, src/api.js там же
const ROOT_DIR   = path.resolve(__dirname, '..');
const API_PORT   = process.env.API_PORT || '3001';
process.env.API_PORT = API_PORT;

// Если приложение запущено упакованным — данные/логи/конфиг должны жить в userData,
// чтобы не писать внутрь asar/Program Files.
if (app.isPackaged) {
  const userData = app.getPath('userData');
  process.env.DB_PATH  = process.env.DB_PATH  || path.join(userData, 'data', 'accounts.db');
  process.env.LOGS_DIR = process.env.LOGS_DIR || path.join(userData, 'logs');
  process.env.ENV_PATH = process.env.ENV_PATH || path.join(userData, '.env');

  // Если .env ещё нет — копируем example
  try {
    if (!fs.existsSync(process.env.ENV_PATH)) {
      const example = path.join(process.resourcesPath, '.env.example');
      if (fs.existsSync(example)) {
        fs.mkdirSync(path.dirname(process.env.ENV_PATH), { recursive: true });
        fs.copyFileSync(example, process.env.ENV_PATH);
      }
    }
  } catch { /* noop */ }
}

let mainWindow = null;
let tray       = null;
let isQuitting = false;

function startApiServer() {
  try {
    require(path.join(ROOT_DIR, 'src', 'api.js'));
  } catch (err) {
    dialog.showErrorBox('Ошибка запуска API', String(err && err.stack || err));
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    title: 'Luma Registration Bot',
    icon: path.join(ROOT_DIR, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Внешние ссылки открываем в системном браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Ждём, пока Express поднимется, и грузим UI.
  // api.js стартует синхронно, но http listen — асинхронно. Пробуем с ретраями.
  const target = `http://127.0.0.1:${API_PORT}/`;
  let tries = 0;
  const tryLoad = () => {
    tries++;
    mainWindow.loadURL(target).catch(() => {
      if (tries < 40) setTimeout(tryLoad, 250);
    });
  };
  tryLoad();
}

function createTray() {
  const iconPath = path.join(ROOT_DIR, 'assets', 'icon.ico');
  try {
    tray = new Tray(fs.existsSync(iconPath) ? iconPath : path.join(ROOT_DIR, 'assets', 'tray.png'));
  } catch {
    // На некоторых системах иконка может не загрузиться — продолжаем без трея
    return;
  }
  tray.setToolTip('Luma Registration Bot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть',  click: () => { if (mainWindow) mainWindow.show(); } },
    { label: 'Скрыть',   click: () => { if (mainWindow) mainWindow.hide(); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Single instance lock — нельзя запустить два экземпляра приложения
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startApiServer();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', (e) => {
    // На Windows: окно закрылось, но трей жив — приложение продолжает работать.
    if (process.platform !== 'darwin' && isQuitting) app.quit();
  });

  app.on('before-quit', () => { isQuitting = true; });
}
