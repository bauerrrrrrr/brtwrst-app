// BRTWRST – Rahmen um das Team-Bratwurst-Intranet mit direktem RCON und LAN-Scan.
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { START_URL, isOwn, isLanAddr, validCmds } = require('./guard');
const rcon = require('./rcon');
const { scan } = require('./scan');

app.setName('BRTWRST');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
function saveBounds() { try { if (win && !win.isMinimized()) fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch {} }

/** Externe Adressen (http/https) im System-Browser öffnen, alles andere ignorieren. */
function openExternal(url) {
  try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch {}
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 900, x: b.x, y: b.y, minWidth: 380, minHeight: 500,
    title: 'BRTWRST', backgroundColor: '#111111', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (b.max) win.maximize();
  win.on('close', saveBounds);

  // Eigene Seiten bleiben im Fenster, alles andere geht in den System-Browser.
  win.webContents.on('will-navigate', (e, url) => { if (!isOwn(url)) { e.preventDefault(); openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) win.loadURL(url); else openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('page-title-updated', (e, t) => { e.preventDefault(); win.setTitle(t ? `${t} · BRTWRST` : 'BRTWRST'); });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = abgebrochen (z. B. durch Weiterleitung)
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: START_URL, err: desc } });
  });
  win.loadURL(START_URL);
}

// Nur unsere Seiten dürfen in die Zwischenablage schreiben, sonst keine Berechtigungen (Kamera, Mikrofon, …).
function permissions() {
  const ok = (wc, perm) => perm === 'clipboard-sanitized-write' && isOwn(wc.getURL());
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok(wc, perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => !!wc && ok(wc, perm));
}

// ---------- Schnittstelle für die Website ----------
const fromOwn = e => !!e.senderFrame && isOwn(e.senderFrame.url);
ipcMain.on('brtwrst:is-own', (e, url) => { e.returnValue = isOwn(url); });
ipcMain.on('brtwrst:version', e => { e.returnValue = app.getVersion(); });
ipcMain.handle('brtwrst:rcon', async (e, { addr, pass, cmds } = {}) => {
  if (!fromOwn(e)) return { ok: false, results: [], error: 'Nicht erlaubt' };
  if (!isLanAddr(addr)) return { ok: false, results: [], error: 'Nur LAN-Adressen erlaubt' };
  if (typeof pass !== 'string' || !pass || pass.length > 64) return { ok: false, results: [], error: 'Passwort fehlt' };
  if (!validCmds(cmds)) return { ok: false, results: [], error: 'Ungültige Befehle' };
  const [host, port] = addr.split(':');
  return rcon.run(host, +port, pass, cmds);
});
ipcMain.handle('brtwrst:scan', async (e, { list } = {}) => {
  if (!fromOwn(e)) return { names: {}, maps: [], error: 'Nicht erlaubt' };
  if (!Array.isArray(list) || list.length > 256) return { names: {}, maps: [], error: 'Ungültige Serverliste' };
  const clean = list.filter(x => Array.isArray(x) && /^\d{1,4}$/.test(String(x[0])) && isLanAddr(x[1]));
  return scan(clean);
});

// ---------- Menü (Alt blendet es ein) ----------
function menu() {
  const go = d => () => { const n = win.webContents.navigationHistory; if (d < 0 ? n.canGoBack() : n.canGoForward()) d < 0 ? n.goBack() : n.goForward(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BRTWRST', submenu: [
      { label: 'Startseite', accelerator: 'Alt+Home', click: () => win.loadURL(START_URL) },
      { label: 'Im Browser öffnen', click: () => openExternal(win.webContents.getURL().startsWith('http') ? win.webContents.getURL() : START_URL) },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { role: 'quit', label: 'Beenden' },
    ] },
    { label: 'Ansicht', submenu: [
      { label: 'Zurück', accelerator: 'Alt+Left', click: go(-1) },
      { label: 'Vorwärts', accelerator: 'Alt+Right', click: go(1) },
      { role: 'reload', label: 'Neu laden' },
      { role: 'forceReload', label: 'Neu laden (ohne Cache)' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Originalgröße' }, { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Vollbild' },
      { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
    ] },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { permissions(); menu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
