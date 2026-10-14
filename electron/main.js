'use strict';

/**
 * Master Cleaner desktop shell.
 *
 * Reuses the existing local HTTP server + web dashboard as the renderer: the
 * main process boots the same engine that `mc serve` uses, binds it to an
 * ephemeral loopback port, and points a sandboxed BrowserWindow at it. This
 * keeps a single UI implementation across CLI, browser and desktop builds.
 */

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');

// Window geometry roughly follows a Lemon-style cleaner: a single compact,
// resizable panel rather than a full-screen app.
const WINDOW = { width: 1080, height: 720, minWidth: 960, minHeight: 640 };

let mainWindow = null;
let server = null;
let serverUrl = null;

function projectUrl() {
  try {
    return require(path.join(__dirname, '..', 'dist', 'core', 'legal.js')).LEGAL.projectUrl;
  } catch {
    return 'https://github.com/siliang42/master-cleaner';
  }
}

async function bootServer() {
  const { startServer } = require(path.join(__dirname, '..', 'dist', 'server.js'));
  // Port 0 => let the OS pick a free loopback port (avoids clashes with `mc serve`).
  server = await startServer(0, false);
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  serverUrl = `http://127.0.0.1:${port}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    title: 'Master Cleaner',
    backgroundColor: '#0d1014',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep the renderer on the local app; send any external link to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (serverUrl && !url.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(`${serverUrl}/`);
}

function openPreferences() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript('window.openSettings && window.openSettings()').catch(() => {});
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const preferencesItem = { label: isMac ? '偏好设置…' : 'Preferences…', accelerator: 'CmdOrCtrl+,', click: openPreferences };
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            preferencesItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : [{ label: 'File', submenu: [preferencesItem, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: '项目主页 / Project home', click: () => shell.openExternal(projectUrl()) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await bootServer();
    } catch (err) {
      dialog.showErrorBox('Master Cleaner 启动失败', `无法启动内置服务：\n${String(err)}`);
      app.quit();
      return;
    }
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      server = null;
    }
  });
}
