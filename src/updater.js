// Signierte Updates über GitHub Releases.
// Jede Version hat ein manifest.json (Version, Dateien mit Größe und SHA-256) und manifest.json.sig (Ed25519).
// Die App nimmt nur ein korrekt signiertes Manifest mit höherer Version und eine Datei mit passender Größe und Prüfsumme.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { PUBLIC_KEY } = require('./update-key');

const BASE = process.env.BRTWRST_UPDATE_URL || 'https://github.com/bauerrrrrrr/brtwrst-app/releases/latest/download';

/** "1.2.10" > "1.2.9" */
function newer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function verifyManifest(raw, sigB64, publicKey = PUBLIC_KEY) {
  try { return crypto.verify(null, Buffer.from(raw), crypto.createPublicKey(publicKey), Buffer.from(String(sigB64).trim(), 'base64')); }
  catch { return false; }
}

function get(url, { maxBytes = 512 * 1024 * 1024, file = null, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'BRTWRST-Updater' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume(); return resolve(get(new URL(res.headers.location, url).href, { maxBytes, file, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} für ${url}`)); }
      const hash = crypto.createHash('sha256'); let size = 0;
      const out = file ? fs.createWriteStream(file) : null; const chunks = [];
      res.on('data', c => {
        size += c.length; if (size > maxBytes) { req.destroy(new Error('Datei zu groß')); return; }
        hash.update(c); if (out) out.write(c); else chunks.push(c);
      });
      res.on('end', () => { const done = () => resolve({ size, sha256: hash.digest('hex'), body: out ? null : Buffer.concat(chunks) }); out ? out.end(done) : done(); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

/** Welche Datei aus dem Manifest passt zu dieser Installation? */
function target() {
  if (process.platform === 'win32') return { key: 'win', mode: 'nsis' };
  if (process.platform === 'darwin') return { key: `mac-${process.arch}`, mode: 'mac' };   // ZIP mit der .app, wird ausgetauscht
  if (process.platform === 'linux' && process.env.FLATPAK_ID) return { key: null, mode: 'flatpak' };   // Updates über das Flatpak-Repo
  if (process.platform === 'linux' && process.env.APPIMAGE) return { key: 'appimage', mode: 'appimage' };
  return { key: null, mode: 'manual' };
}

/** Prüft auf eine neue Version. → null oder { version, file, mode, notes } */
async function check(current) {
  const m = await get(`${BASE}/manifest.json`, { maxBytes: 64 * 1024 });
  const s = await get(`${BASE}/manifest.json.sig`, { maxBytes: 1024 });
  if (!verifyManifest(m.body, s.body.toString())) throw new Error('Signatur des Update-Manifests ungültig');
  const man = JSON.parse(m.body.toString());
  if (!man.version || !newer(man.version, current)) return null;
  const t = target();
  return { version: man.version, notes: man.notes || '', mode: t.mode, file: t.key ? man.files?.[t.key] : null };
}

/** Lädt die Datei, prüft Größe und SHA-256. → Pfad der geprüften Datei */
async function download(file, dir) {
  if (!file || !/^[\w.-]+$/.test(file.name) || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('Update-Manifest unvollständig');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file.name), part = dest + '.part';
  const r = await get(`${BASE}/${encodeURIComponent(file.name)}`, { file: part, maxBytes: file.size + 1 });
  if (r.size !== file.size || r.sha256 !== file.sha256) { fs.rmSync(part, { force: true }); throw new Error('Prüfsumme des Updates passt nicht'); }
  fs.renameSync(part, dest);
  return dest;
}

/** AppImage tauschen: alte Datei als .bak behalten, neue an ihre Stelle. → Pfad der neuen AppImage */
function swapAppImage(downloaded, current = process.env.APPIMAGE) {
  fs.chmodSync(downloaded, 0o755);
  const bak = current + '.bak';
  fs.rmSync(bak, { force: true });
  fs.renameSync(current, bak);
  try { fs.renameSync(downloaded, current); }
  catch { fs.copyFileSync(downloaded, current); fs.chmodSync(current, 0o755); fs.rmSync(downloaded, { force: true }); }
  return current;
}

/** Pfad der laufenden .app (…/BRTWRST.app/Contents/MacOS/BRTWRST → …/BRTWRST.app) oder null */
function macAppPath(exe = process.execPath) {
  const app = path.resolve(exe, '..', '..', '..');
  return app.endsWith('.app') ? app : null;
}

/**
 * macOS: ZIP mit ditto entpacken (erhält Signatur und Rechte), die laufende .app gegen die neue tauschen.
 * Die alte wandert nach <arbeitsordner>/alt.app und wird beim nächsten Update entfernt. → Pfad der neuen .app
 */
function swapMacApp(zip, current = macAppPath(), work = path.dirname(zip), unzip = (z, d) => require('child_process').execFileSync('ditto', ['-x', '-k', z, d])) {
  if (!current) throw new Error('Die App läuft nicht aus einem .app-Paket');
  const out = path.join(work, 'neu');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  unzip(zip, out);
  const name = fs.readdirSync(out).find(n => n.endsWith('.app'));
  if (!name) throw new Error('Im Update steckt keine .app');
  const old = path.join(work, 'alt.app');
  fs.rmSync(old, { recursive: true, force: true });
  try { fs.accessSync(path.dirname(current), fs.constants.W_OK); }
  catch { throw new Error(`Keine Schreibrechte für ${path.dirname(current)}. Bitte die App in den Ordner „Programme“ legen oder das Update von Hand installieren.`); }
  fs.renameSync(current, old);
  try { fs.renameSync(path.join(out, name), current); }
  catch (e) { fs.renameSync(old, current); throw e; }   // zurückrollen
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  return current;
}

module.exports = { BASE, newer, verifyManifest, check, download, swapAppImage, swapMacApp, macAppPath, target };
