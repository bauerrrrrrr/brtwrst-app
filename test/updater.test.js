'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

// Testschlüssel statt des echten: Updater-Modul mit eigenem öffentlichen Schlüssel laden
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }), PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });

function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      const f = path.join(dir, decodeURIComponent(q.url.split('?')[0].slice(1)));
      if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200); fs.createReadStream(f).pipe(r);
    });
    srv.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}

function loadUpdater(base) {
  process.env.BRTWRST_UPDATE_URL = base;
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
  require.cache[require.resolve('../src/update-key')] = { exports: { PUBLIC_KEY: PUB }, loaded: true, id: require.resolve('../src/update-key') };
  return require('../src/updater');
}

function release(dir, version, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'manifest.js'), dir, version, 'Testnotiz'], { env: { ...process.env, BRTWRST_SIGNING_KEY: PRIV }, stdio: 'pipe' });
}

test('Versionsvergleich', () => {
  const u = loadUpdater('http://x');
  assert.equal(u.newer('0.1.1', '0.1.0'), true);
  assert.equal(u.newer('0.10.0', '0.9.9'), true);
  assert.equal(u.newer('0.1.0', '0.1.0'), false);
  assert.equal(u.newer('0.0.9', '0.1.0'), false);
});

test('Signiertes Manifest: neue Version gefunden, Datei geprüft geladen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  release(dir, '0.1.1', { 'BRTWRST-0.1.1-linux-x86_64.AppImage': 'NEU', 'BRTWRST-0.1.1-win-x64.exe': 'WIN' });
  const s = await serve(dir); const u = loadUpdater(s.url);
  process.env.APPIMAGE = '/x/BRTWRST.AppImage';
  try {
    const r = await u.check('0.1.0');
    assert.equal(r.version, '0.1.1'); assert.equal(r.notes, 'Testnotiz');
    if (process.platform === 'linux') { assert.equal(r.mode, 'appimage'); assert.equal(r.file.name, 'BRTWRST-0.1.1-linux-x86_64.AppImage'); }
    assert.equal(await u.check('0.1.1'), null, 'gleiche Version ist kein Update');
    const f = r.file || { name: 'BRTWRST-0.1.1-linux-x86_64.AppImage', size: 3, sha256: crypto.createHash('sha256').update('NEU').digest('hex') };
    const prog = [];
    const got = await u.download(f, path.join(dir, 'dl'), p => prog.push(p));
    assert.equal(fs.readFileSync(got, 'utf8'), 'NEU');
    assert.equal(prog.at(-1), 1, 'Fortschritt endet bei 100 %');
    fs.rmSync(path.join(dir, f.name));   // Quelle weg: zweiter Aufruf muss die schon geladene Datei nehmen
    const again = []; assert.equal(await u.download(f, path.join(dir, 'dl'), p => again.push(p)), got);
    assert.deepEqual(again, [1]);
  } finally { delete process.env.APPIMAGE; s.close(); }
});

test('Manipuliertes Manifest wird abgelehnt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  release(dir, '0.1.1', { 'BRTWRST-0.1.1-linux-x86_64.AppImage': 'NEU' });
  fs.writeFileSync(path.join(dir, 'manifest.json'), fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace('0.1.1', '9.9.9'));
  const s = await serve(dir); const u = loadUpdater(s.url);
  try { await assert.rejects(u.check('0.1.0'), /Signatur/); } finally { s.close(); }
});

test('Fremder Schlüssel wird abgelehnt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(path.join(dir, 'BRTWRST-0.2.0-linux-x86_64.AppImage'), 'BOESE');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'manifest.js'), dir, '0.2.0'], { env: { ...process.env, BRTWRST_SIGNING_KEY: other }, stdio: 'pipe' });
  const s = await serve(dir); const u = loadUpdater(s.url);
  try { await assert.rejects(u.check('0.1.0'), /Signatur/); } finally { s.close(); }
});

test('Ausgetauschte Datei (falsche Prüfsumme) wird verworfen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  release(dir, '0.1.1', { 'BRTWRST-0.1.1-linux-x86_64.AppImage': 'NEU' });
  fs.writeFileSync(path.join(dir, 'BRTWRST-0.1.1-linux-x86_64.AppImage'), 'BOS');   // gleiche Länge, anderer Inhalt
  const s = await serve(dir); const u = loadUpdater(s.url);
  process.env.APPIMAGE = '/x/BRTWRST.AppImage';
  try {
    const r = await u.check('0.1.0');
    const file = r.file || JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))).files.appimage;
    await assert.rejects(u.download(file, path.join(dir, 'dl')), /Prüfsumme/);
    assert.equal(fs.existsSync(path.join(dir, 'dl', file.name)), false);
  } finally { delete process.env.APPIMAGE; s.close(); }
});

test('AppImage tauschen: neue an alte Stelle, alte als .bak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-'));
  const cur = path.join(dir, 'BRTWRST.AppImage'), neu = path.join(dir, 'neu.AppImage');
  fs.writeFileSync(cur, 'ALT'); fs.writeFileSync(neu, 'NEU');
  const u = loadUpdater('http://x');
  const out = u.swapAppImage(neu, cur);
  assert.equal(out, cur);
  assert.equal(fs.readFileSync(cur, 'utf8'), 'NEU');
  assert.equal(fs.readFileSync(cur + '.bak', 'utf8'), 'ALT');
  if (process.platform !== 'win32') assert.ok(fs.statSync(cur).mode & 0o111, 'ausführbar');
});
