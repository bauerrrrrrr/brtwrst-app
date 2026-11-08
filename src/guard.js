// Wer darf was: nur Seiten von unserer Domain bekommen RCON und Scan, und die gehen nur an LAN-Adressen.
'use strict';

const START_URL = process.env.BRTWRST_URL || 'https://lan.brat.wurst.pw/';
const ALLOWED = [
  { origin: 'https://lan.brat.wurst.pw', path: '/' },
  { origin: 'https://brat.wurst.pw', path: '/lan/' },
];
// Zum Testen (BRTWRST_URL=http://127.0.0.1:…) gilt auch die Start-Adresse als eigene Seite.
if (process.env.BRTWRST_URL) { const u = new URL(START_URL); ALLOWED.push({ origin: u.origin, path: '/' }); }

/** Gehört die Adresse zu unserer Website? */
function isOwn(url) {
  try { const u = new URL(url); return ALLOWED.some(a => u.origin === a.origin && u.pathname.startsWith(a.path)); }
  catch { return false; }
}

/** Nur private/lokale IPv4-Adressen mit Port: 10/8, 172.16/12, 192.168/16, 127/8. */
function isLanAddr(addr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(String(addr));
  if (!m) return false;
  const [a, b, c, d, port] = m.slice(1).map(Number);
  if ([a, b, c, d].some(x => x > 255) || port < 1 || port > 65535) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Befehle: Liste aus Text, ohne Zeilenumbrüche, in vernünftiger Länge. */
function validCmds(cmds) {
  return Array.isArray(cmds) && cmds.length >= 1 && cmds.length <= 200 &&
    cmds.every(c => typeof c === 'string' && c.length >= 1 && c.length <= 512 && !/[\r\n\0]/.test(c));
}

module.exports = { START_URL, isOwn, isLanAddr, validCmds };
