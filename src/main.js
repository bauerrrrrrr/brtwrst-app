// BRTWRST – Rahmen um das Team-Bratwurst-Intranet mit direktem RCON und LAN-Scan.
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, session, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { START_URL, isOwn, isLanAddr, validCmds } = require('./guard');
const rcon = require('./rcon');
const { scan, a2sPlayers } = require('./scan');
const updater = require('./updater');
const gsi = require('./gsi');
const flatpak = require('./flatpak');

// AppImage: Viele Distributionen (z. B. Ubuntu 24.04) erlauben die Chromium-Sandbox ohne Installation nicht.
// Die Fenster laufen trotzdem isoliert (contextIsolation, kein nodeIntegration) und laden nur unsere Seite.
if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');

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

ipcMain.handle('brtwrst:players', async (e, { addr } = {}) => {
  if (!fromOwn(e)) return { ok: false, players: [], error: 'Nicht erlaubt' };
  if (!isLanAddr(addr)) return { ok: false, players: [], error: 'Nur LAN-Adressen erlaubt' };
  return a2sPlayers(addr);
});
ipcMain.handle('brtwrst:gsi-install', async (e, { token } = {}) => {
  if (!fromOwn(e)) return { ok: false, error: 'Nicht erlaubt' };
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{8,200}$/.test(token)) return { ok: false, error: 'Ungültiger Schlüssel' };
  const u = new URL('gsi.php', e.senderFrame.url); u.search = ''; u.hash = '';
  return gsi.install(u.href, token);
});

// ---------- Updates (signiert, über GitHub Releases) ----------
const RELEASES = 'https://github.com/bauerrrrrrr/brtwrst-app/releases/latest';
let updating = false, skipped = null, upState = '';
const upLog = msg => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), `${new Date().toISOString()} ${msg}\n`); } catch {} };
async function checkUpdates(manual = false) {
  if (updating) {   // läuft schon (z. B. Download im Hintergrund): Stand zeigen statt still nichts zu tun
    if (manual) await dialog.showMessageBox(win, { type: 'info', message: 'Update läuft bereits', detail: upState || 'Suche nach Updates …', buttons: ['OK'] });
    return;
  }
  updating = true; upState = 'Suche nach Updates …';
  const ask = async (opts) => process.env.BRTWRST_UPDATE_YES ? 0 : (await dialog.showMessageBox(win, { type: 'info', noLink: true, ...opts })).response;
  try {
    const u = await updater.check(app.getVersion());
    if (!u) { if (manual) await ask({ message: 'BRTWRST ist aktuell.', detail: `Version ${app.getVersion()}`, buttons: ['OK'] }); return; }
    if (!manual && skipped === u.version) return;
    if (u.mode === 'flatpak') return await flatpakUpdate(u, ask);
    if (u.mode === 'manual' || !u.file) {
      if (await ask({ message: `Neue Version ${u.version} verfügbar`, detail: 'Diese Installation aktualisiert sich nicht selbst. Lade die neue Version herunter.', buttons: ['Download öffnen', 'Später'] }) === 0) openExternal(RELEASES);
      else skipped = u.version;
      return;
    }
    upLog(`Version ${u.version} gefunden, lade ${u.file.name}`);
    upState = `Version ${u.version} wird geladen …`;
    if (manual && !process.env.BRTWRST_UPDATE_YES) dialog.showMessageBox(win, { type: 'info', message: `Version ${u.version} gefunden`, detail: `Sie wird im Hintergrund geladen (${Math.round(u.file.size / 1e6)} MB, Fortschritt im ${process.platform === 'darwin' ? 'Dock' : 'Taskleisten'}-Symbol). Danach kommt die Frage zum Neustart.`, buttons: ['OK'] });
    let shown = -1;
    const file = await updater.download(u.file, path.join(app.getPath('userData'), 'updates'), f => {
      const pct = Math.floor(f * 100);
      if (pct === shown) return; shown = pct;
      upState = `Version ${u.version} wird geladen: ${pct} %`;
      win?.setProgressBar(Math.max(0.01, f));   // Fortschritt im Dock bzw. in der Taskleiste
    });
    win?.setProgressBar(-1);
    upLog(`${u.file.name} geladen und geprüft`);
    if (await ask({ message: `Version ${u.version} ist bereit`, detail: (u.notes ? u.notes + '\n\n' : '') + 'Jetzt neu starten und aktualisieren?', buttons: ['Jetzt neu starten', 'Später'] }) !== 0) { skipped = u.version; return; }
    saveBounds();
    if (u.mode === 'nsis') {
      spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      app.quit();
    } else if (u.mode === 'mac') {
      const appPath = updater.swapMacApp(file);
      spawn('/bin/sh', ['-c', 'sleep 1; open -n "$0"', appPath], { detached: true, stdio: 'ignore' }).unref();   // neue App starten, wenn die alte weg ist
      app.exit(0);
    } else if (u.mode === 'appimage') {
      const exe = updater.swapAppImage(file);
      spawn(exe, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref();   // gleiche Startparameter wie bisher
      app.exit(0);
    }
  } catch (e) {
    win?.setProgressBar(-1);
    upLog('Fehler: ' + e.message);
    if (manual) await dialog.showMessageBox(win, { type: 'warning', message: 'Update nicht möglich', detail: e.message, buttons: ['OK'] });
    else console.error('Update-Prüfung:', e.message);
  } finally { updating = false; upState = ''; }
}

/** Flatpak: Update aus unserem Flatpak-Repo über das Portal holen, sonst Hinweis auf Discover / flatpak update. */
async function flatpakUpdate(u, ask) {
  if (await ask({ message: `Neue Version ${u.version} verfügbar`, detail: `Installiert ist ${app.getVersion()}. Das Update kommt aus dem BRTWRST-Flatpak-Repo.`, buttons: ['Jetzt aktualisieren', 'Später'] }) !== 0) { skipped = u.version; return; }
  let result;
  try {
    win?.setProgressBar(0.01);
    result = await flatpak.update(p => win?.setProgressBar(Math.max(0.01, p / 100)));
  } catch (e) {
    await dialog.showMessageBox(win, { type: 'warning', message: 'Update nicht möglich', detail: `${e.message}\n\n${flatpak.manualHint}`, buttons: ['OK'] });
    return;
  } finally { win?.setProgressBar(-1); }
  if (result === 'empty') {
    await ask({ message: 'Noch nicht im Flatpak-Repo', detail: `Version ${u.version} ist veröffentlicht, aber das Flatpak-Repo hat sie noch nicht. Bitte in ein paar Minuten noch einmal versuchen.\n\n${flatpak.manualHint}`, buttons: ['OK'] });
    return;
  }
  if (await ask({ message: `Version ${u.version} ist installiert`, detail: 'Jetzt neu starten?', buttons: ['Jetzt neu starten', 'Später'] }) !== 0) return;
  saveBounds();
  flatpak.relaunch(process.argv.slice(1));
  app.exit(0);
}

// ---------- Menü (Alt blendet es ein) ----------
function menu() {
  const go = d => () => { const n = win.webContents.navigationHistory; if (d < 0 ? n.canGoBack() : n.canGoForward()) d < 0 ? n.goBack() : n.goForward(); };
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BRTWRST', submenu: [
      { label: 'Startseite', accelerator: mac ? 'Cmd+Shift+H' : 'Alt+Home', click: () => win.loadURL(START_URL) },
      { label: 'Im Browser öffnen', click: () => openExternal(win.webContents.getURL().startsWith('http') ? win.webContents.getURL() : START_URL) },
      { type: 'separator' },
      { label: 'Nach Updates suchen', click: () => checkUpdates(true) },
      { label: `Version ${app.getVersion()}`, enabled: false },
      ...(mac ? [{ type: 'separator' }, { role: 'hide', label: 'BRTWRST ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' }] : []),
      { role: 'quit', label: 'Beenden' },
    ] },
    { role: 'editMenu', label: 'Bearbeiten' },   // macOS: ohne dieses Menü gehen Cmd+C/Cmd+V nicht
    { label: 'Ansicht', submenu: [
      { label: 'Zurück', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: go(-1) },
      { label: 'Vorwärts', accelerator: mac ? 'Cmd+]' : 'Alt+Right', click: go(1) },
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
app.whenReady().then(() => {
  permissions(); menu(); createWindow();
  if (app.isPackaged || process.env.BRTWRST_UPDATE_URL) {
    setTimeout(() => checkUpdates(false), 10000);
    setInterval(() => checkUpdates(false), 4 * 3600 * 1000);
  }
});
app.on('window-all-closed', () => app.quit());
