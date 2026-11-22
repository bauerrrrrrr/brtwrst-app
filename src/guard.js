// Wer darf was: nur Seiten von unserer Domain bekommen RCON und Scan, und die gehen nur an LAN-Adressen.
'use strict';

const START_URL = process.env.BRTWRST_URL || 'https://brat.wurst.pw/lan/';
const ALLOWED = [
  { origin: 'https://brat.wurst.pw', path: '/lan/' },
];
// Zum Testen (BRTWRST_URL=http://127.0.0.1:…) gilt auch die Start-Adresse als eigene Seite.
if (process.env.BRTWRST_URL) { const u = new URL(START_URL); ALLOWED.push({ origin: u.origin, path: '/' }); }

/** Gehört die Adresse zu unserer Website? */
function isOwn(url) {
  try { const u = new URL(url); return ALLOWED.some(a => u.origin === a.origin && u.pathname.startsWith(a.path)); }
  catch { return false; }
}

/**
 * Steam-Anmeldung (OpenID) für den Login der Website: darf im Hauptfenster laufen statt im Browser.
 * Nur https ohne Zugangsdaten in der URL: steamcommunity.com/openid/… und /login/…, login.steampowered.com.
 */
function isSteamLogin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    if (u.hostname === 'steamcommunity.com') return u.pathname.startsWith('/openid/') || u.pathname.startsWith('/login/');
    return u.hostname === 'login.steampowered.com';
  } catch { return false; }
}

/** Nur private/lokale IPv4-Adressen mit Port: 10/8, 172.16/12, 192.168/16, 127/8. */
function isLanAddr(addr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(String(addr));
  if (!m) return false;
  const [a, b, c, d, port] = m.slice(1).map(Number);
  if ([a, b, c, d].some(x => x > 255) || port < 1 || port > 65535) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Ziel für CS2-GSI: http(s) zu unserer Website oder zu einer LAN-Adresse (z. B. Empfänger auf der LAN). */
function isGsiTarget(uri) {
  try {
    const u = new URL(uri);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
    return isOwn(u.href) || isLanAddr(`${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`);
  } catch { return false; }
}

/**
 * GSI-cfg von der Website: nur einfache VDF-Zeilen ("Schlüssel" bzw. "Schlüssel" "Wert", { und }),
 * Kopf "BRTWRST Beamer", genau eine URI mit erlaubtem Ziel und der übergebene Schlüssel.
 */
function validGsiCfg(cfg, token) {
  if (typeof cfg !== 'string' || !cfg || cfg.length > 4096 || /[\r\0]/.test(cfg)) return false;
  const lines = cfg.split('\n').filter(l => l.trim());
  if (lines[0] !== '"BRTWRST Beamer"') return false;
  if (!lines.every(l => /^\s*(\{|\}|"[A-Za-z0-9_ ]{1,64}"(\s+"[^"\\]{0,512}")?)\s*$/.test(l))) return false;
  const uris = [...cfg.matchAll(/^\s*"uri"\s+"([^"]*)"\s*$/gm)].map(m => m[1]);
  return uris.length === 1 && isGsiTarget(uris[0]) && cfg.includes(`"token" "${token}"`);
}

/** Befehle: Liste aus Text, ohne Zeilenumbrüche, in vernünftiger Länge. */
function validCmds(cmds) {
  return Array.isArray(cmds) && cmds.length >= 1 && cmds.length <= 200 &&
    cmds.every(c => typeof c === 'string' && c.length >= 1 && c.length <= 512 && !/[\r\n\0]/.test(c));
}

module.exports = { START_URL, isOwn, isSteamLogin, isLanAddr, isGsiTarget, validCmds, validGsiCfg };
