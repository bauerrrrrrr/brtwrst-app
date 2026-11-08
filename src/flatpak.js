// Läuft die App als Flatpak, kommen Updates aus unserem Flatpak-Repo statt aus dem GitHub-Release.
// Das Update stößt die App über das Flatpak-Portal an (org.freedesktop.portal.Flatpak, UpdateMonitor):
// Flatpak lädt die neue Version aus dem eingebundenen, GPG-signierten Repo, ohne die Sandbox zu öffnen.
'use strict';
const { spawn } = require('child_process');
const { Bus } = require('./dbus');

const APP_ID = 'pw.wurst.brat.Brtwrst';
const DEST = 'org.freedesktop.portal.Flatpak';
const IFACE = 'org.freedesktop.portal.Flatpak';
const MON = 'org.freedesktop.portal.Flatpak.UpdateMonitor';

const isFlatpak = () => !!process.env.FLATPAK_ID;
const manualHint = `Über Discover bzw. „Software“ aktualisieren oder im Terminal: flatpak update ${APP_ID}`;

/**
 * Update über das Portal installieren.
 * → 'done' (installiert, Neustart nötig) | 'empty' (im Repo noch nichts Neues)
 * Wirft einen Fehler mit Meldung, z. B. wenn die neue Version zusätzliche Rechte braucht.
 */
async function update(onProgress = () => {}, { timeoutMs = 15 * 60 * 1000, addr } = {}) {
  const bus = await Bus.connect(addr);
  let monitor = null;
  try {
    [monitor] = await bus.call({ dest: DEST, path: '/org/freedesktop/portal/Flatpak', iface: IFACE, member: 'CreateUpdateMonitor', sig: 'a{sv}', body: [{}] });
    await bus.addMatch(`type='signal',sender='${DEST}',path='${monitor}',interface='${MON}'`);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Zeitüberschreitung beim Update')), timeoutMs);
      const done = (fn, v) => { clearTimeout(timer); off(); fn(v); };
      const off = bus.onSignal(msg => {
        if (msg.path !== monitor || msg.member !== 'Progress') return;
        const info = msg.body[0] || {};
        if (typeof info.progress === 'number') onProgress(info.progress);
        if (info.status === 1) done(resolve, 'empty');
        else if (info.status === 2) done(resolve, 'done');
        else if (info.status === 3) done(reject, new Error(info.error_message || info.error || 'Update fehlgeschlagen'));
      });
      bus.call({ dest: DEST, path: monitor, iface: MON, member: 'Update', sig: 'sa{sv}', body: ['', {}] }).catch(e => done(reject, e));
    });
  } finally {
    if (monitor) await bus.call({ dest: DEST, path: monitor, iface: MON, member: 'Close' }).catch(() => {});
    bus.close();
  }
}

/** Neue Version starten (eigene Sandbox, neueste installierte Version). */
function relaunch(args = []) {
  spawn('flatpak-spawn', ['--latest-version', '/app/bin/brtwrst', ...args], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { APP_ID, isFlatpak, manualHint, update, relaunch };
