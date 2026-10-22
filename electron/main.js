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
let trayDisk = null; // last /api/state disk snapshot shown in the tray menu
let scanActive = false;
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
    return createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
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

function updateTray() {
  if (!tray) return;
  const zh = langPref === 'zh-CN';
  const suffix = busy ? (zh ? '正在快速清理…' : 'quick cleaning…') : scanActive ? (zh ? '正在扫描…' : 'scanning…') : '';
  tray.setToolTip('Master Cleaner' + (suffix ? ' · ' + suffix : ''));
}

/** Pull disk/scan status so the tray menu shows live information. */
async function refreshTrayStatus() {
  if (!serverUrl) return;
  try {
    const r = await fetch(serverUrl + '/api/state', { cache: 'no-store' });
    const s = await r.json();
    if (s && s.disk) trayDisk = s.disk;
    scanActive = !!(s && s.scanning);
    updateTray();
  } catch { /* keep the previous snapshot */ }
}

function trayMenuTemplate() {
  const zh = langPref === 'zh-CN';
  const t = (cn, en) => (zh ? cn : en);
  return [
    { label: t('打开主窗口', 'Open Master Cleaner'), click: showWindow },
    { type: 'separator' },
    { label: scanActive ? t('扫描进行中…', 'Scanning…') : t('立即扫描', 'Scan now'), enabled: !scanActive, click: () => startScanFromTray() },
    { label: busy ? t('正在快速清理…', 'Quick clean running…') : t('快速清理（安全项）', 'Quick clean (safe items)'), enabled: !busy, click: () => void quickClean() },
    { type: 'separator' },
    {
      label: trayDisk
        ? t(`磁盘剩余 ${trayDisk.freeHuman} / 共 ${trayDisk.totalHuman}`, `Disk: ${trayDisk.freeHuman} free of ${trayDisk.totalHuman}`)
        : t('读取磁盘状态…', 'Reading disk status…'),
      enabled: false,
    },
    { type: 'separator' },
    { label: t('切换为 English', '切换到简体中文'), click: () => toggleLanguage() },
    { type: 'separator' },
    { label: t('退出', 'Quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ];
}

/** Open the dashboard and start a scan through the page API. */
function startScanFromTray() {
  const win = showWindow();
  if (!win) return;
  const kick = () => {
    win.webContents
      .executeJavaScript('window.MC_API && window.MC_API.runScan && window.MC_API.runScan();', true)
      .catch(() => {});
    scanActive = true;
    updateTray();
    setTimeout(() => void refreshTrayStatus(), 2000);
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', kick);
  else kick();
}

function toggleLanguage() {
  const next = langPref === 'zh-CN' ? 'en' : 'zh-CN';
  langPref = next;
  updateTray();
  if (!mainWindow) {
    const win = createWindow();
    if (win) win.webContents.once('did-finish-load', () => applyLanguage(next));
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
    if (process.platform === 'darwin') {
      const template = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
      if (!template.isEmpty()) {
        template.setTemplateImage(true); // adapts to light and dark menu bars
        icon = template;
      }
    }
    if (icon.isEmpty()) {
      const src = nativeImage.createFromPath(path.join(__dirname, '..', 'web', 'logo-square.png'));
      if (!src.isEmpty()) icon = src.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 });
    }
  } catch { /* keep empty icon */ }

  tray = new Tray(icon);
  updateTray();

  // Primary click opens the dashboard; right-click / control-click opens the
  // quick-action menu (scan, quick clean, disk status, language, quit).
  tray.on('click', () => showWindow());
  tray.on('right-click', () => {
    void refreshTrayStatus().finally(() => {
      if (tray) tray.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
    });
  });
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
