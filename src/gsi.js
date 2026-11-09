// GSI-Datei (CS2 Game State Integration) in alle gefundenen CS2-cfg-Ordner legen.
// Die Datei baut die App selbst; die Adresse ist gsi.php neben der aufrufenden (eigenen) Seite.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = 'gamestate_integration_brtwrst.cfg';
const DATA = ['provider', 'map', 'round', 'player_id', 'player_state', 'player_weapons', 'player_match_stats', 'player_position', 'phase_countdowns'];

/** Gleicher Aufbau wie die Download-Datei auf der Seite (app/pages/gsi.php). */
function buildCfg(uri, token) {
  return `"BRTWRST Beamer"\n{\n  "uri"       "${uri}"\n  "timeout"   "5.0"\n  "buffer"    "0.1"\n  "throttle"  "0.25"\n  "heartbeat" "10.0"\n`
    + `  "auth"\n  {\n    "token" "${token}"\n  }\n  "data"\n  {\n${DATA.map(d => `    "${d}" "1"\n`).join('')}  }\n}\n`;
}

/** Mögliche Steam-Hauptordner je System. */
function steamRoots() {
  const home = os.homedir(), roots = [];
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
      const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out); if (m) roots.push(m[1].trim().replace(/\//g, '\\'));
    } catch {}
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else {
    roots.push(path.join(home, '.local/share/Steam'), path.join(home, '.steam/steam'), path.join(home, '.steam/root'),
      path.join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'), path.join(home, 'snap/steam/common/.local/share/Steam'));
  }
  return roots;
}

/** Alle Steam-Bibliotheken (Hauptordner + libraryfolders.vdf). */
function libraries(roots) {
  const libs = new Set();
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    libs.add(fs.realpathSync(r));
    try {
      const vdf = fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) { const p = m[1].replace(/\\\\/g, '\\'); if (fs.existsSync(p)) libs.add(fs.realpathSync(p)); }
    } catch {}
  }
  return [...libs];
}

function cfgDirs(roots = steamRoots()) {
  return libraries(roots).map(l => path.join(l, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')).filter(d => fs.existsSync(d));
}

/** → { ok, paths } bzw. { ok: false, error } */
function install(uri, token, roots) {
  if (process.platform === 'darwin' && !roots) return { ok: false, error: 'CS2 gibt es nicht für macOS. Die GSI-Datei gehört auf den Spiel-PC (Windows oder Linux).' };
  const dirs = cfgDirs(roots);
  if (!dirs.length) return { ok: false, error: 'CS2 nicht gefunden. Bitte die Datei herunterladen und von Hand in den cfg-Ordner legen.' };
  const paths = [];
  for (const d of dirs) {
    const f = path.join(d, FILE);
    try { fs.writeFileSync(f, buildCfg(uri, token)); paths.push(f); } catch (e) { return { ok: false, error: `Schreiben nicht möglich (${f}): ${e.message}` }; }
  }
  return { ok: true, paths };
}

module.exports = { buildCfg, cfgDirs, install, FILE };
