'use strict';

/**
 * Master Cleaner desktop shell.
 *
 * Reuses the existing local HTTP server + web dashboard as the renderer, and adds a
 * menu-bar/tray presence so the app keeps running in the background: closing the window
 * hides it, a single click on the menu-bar logo switches language, a double click runs a
 * quick clean of the default (safe) selection.
 */

const path = require('path');
const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, Notification } = require('electron');

const WINDOW = { width: 1080, height: 720, minWidth: 960, minHeight: 640 };

let mainWindow = null;
let tray = null;
let server = null;
let serverUrl = null;
let langPref = null; // 'zh-CN' | 'en'
let clickTimer = null;
let busy = false;

app.isQuitting = false;

function projectUrl() {
  try {
    return require(path.join(__dirname, '..', 'dist', 'core', 'legal.js')).LEGAL.projectUrl;
  } catch {
    return 'https://github.com/siliang42/master-cleaner';
  }
}

async function bootServer() {
  const { startServer } = require(path.join(__dirname, '..', 'dist', 'server.js'));
  server = await startServer(0, false);
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  serverUrl = 'http://127.0.0.1:' + port;
}

function createWindow() {
  if (mainWindow) return mainWindow;
  mainWindow = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    title: 'Master Cleaner',
    backgroundColor: '#0d1014',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

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

  // Background mode: closing the window keeps the app alive in the menu bar.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  void mainWindow.loadURL(serverUrl + '/');
  return mainWindow;
}

function showWindow() {
  if (!mainWindow) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function readLocale() {
  try {
    const r = await fetch(serverUrl + '/api/state', { cache: 'no-store' });
    const s = await r.json();
    return s && s.locale === 'zh-CN' ? 'zh-CN' : 'en';
  } catch {
    return 'en';
  }
}

function trayLabel() {
  return (langPref === 'zh-CN' ? 'Master Cleaner · 中文' : 'Master Cleaner · English');
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(trayLabel() + (busy ? ' · 正在清理…' : ''));
}

/* Single click on the menu-bar logo flips the UI language; a double click runs a quick clean. */
function toggleLanguage() {
  const next = langPref === 'zh-CN' ? 'en' : 'zh-CN';
  langPref = next;
  updateTray();
  if (!mainWindow) {
    void createWindow().then(() => applyLanguage(next));
    return;
  }
  applyLanguage(next);
}

function applyLanguage(loc) {
  if (!mainWindow) return;
  const code = 'try{localStorage.setItem(\'mc-lang\',\'' + loc + '\');}catch(e){}location.reload();';
  mainWindow.webContents.executeJavaScript(code).catch(() => {});
}

async function quickClean() {
  if (busy) return;
  busy = true;
  updateTray();
  if (Notification && Notification.isSupported()) {
    new Notification({ title: 'Master Cleaner', body: langPref === 'zh-CN' ? '正在快速清理…' : 'Quick clean running…' }).show();
  }
  try {
    const r = await fetch(serverUrl + '/api/quick-clean?lang=' + encodeURIComponent(langPref || 'en'), { method: 'POST' });
    const d = await r.json();
    const body = d && d.ok
      ? (langPref === 'zh-CN'
          ? '已清理 ' + d.count + ' 项，释放 ' + d.bytesHuman
          : 'Cleaned ' + d.count + ' items, freed ' + d.bytesHuman)
      : (langPref === 'zh-CN' ? '快速清理失败：' + ((d && d.error) || '未知错误') : 'Quick clean failed: ' + ((d && d.error) || 'unknown'));
    if (Notification && Notification.isSupported()) new Notification({ title: 'Master Cleaner', body }).show();
    if (mainWindow) mainWindow.webContents.send && mainWindow.webContents.send('noop');
  } catch (err) {
    if (Notification && Notification.isSupported()) {
      new Notification({ title: 'Master Cleaner', body: String(err) }).show();
    }
  } finally {
    busy = false;
    updateTray();
  }
}

function buildTray() {
  if (tray) return;
  let icon = nativeImage.createEmpty();
  try {
    const src = nativeImage.createFromPath(path.join(__dirname, '..', 'web', 'logo-square.png'));
    if (!src.isEmpty()) icon = src.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 });
  } catch { /* keep empty icon */ }

  tray = new Tray(icon);
  updateTray();

  tray.on('click', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      toggleLanguage();
    }, 260);
  });
  tray.on('double-click', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    void quickClean();
  });

  const zh = () => langPref === 'zh-CN';
  const menu = Menu.buildFromTemplate([
    { label: zh() ? '打开主窗口' : 'Open window', click: showWindow },
    { label: zh() ? '快速清理' : 'Quick clean', click: () => void quickClean() },
    { label: zh() ? '切换语言' : 'Switch language', click: () => toggleLanguage() },
    { type: 'separator' },
    { label: zh() ? '退出' : 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: '打开主窗口 / Show window', click: showWindow },
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
      : [{ label: 'File', submenu: [{ label: 'Show window', click: showWindow }, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: '项目主页 / Project home', click: () => shell.openExternal(projectUrl()) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await bootServer();
    } catch (err) {
      dialog.showErrorBox('Master Cleaner 启动失败', '无法启动内置服务：\n' + String(err));
      app.quit();
      return;
    }
    langPref = await readLocale();
    await createWindow();
    buildTray();

    app.on('activate', () => showWindow());
  });

  // With a menu-bar presence the app stays resident on every platform.
  app.on('window-all-closed', () => { /* keep running in the tray */ });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (server) {
      try { server.close(); } catch { /* ignore */ }
      server = null;
    }
  });
}
