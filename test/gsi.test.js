'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const gsi = require('../src/gsi');

test('GSI: Datei in alle CS2-Bibliotheken (Hauptordner + libraryfolders.vdf)', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const cs = lib => path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  const main = path.join(t, 'Steam'), extra = path.join(t, 'Spiele');
  fs.mkdirSync(path.join(main, 'steamapps'), { recursive: true });
  fs.mkdirSync(cs(extra), { recursive: true });
  fs.writeFileSync(path.join(main, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${main}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${extra}"\n\t}\n}\n`);
  const cfg = '"BRTWRST Beamer"\n{\n  "uri" "https://brat.wurst.pw/lan/gsi.php"\n}\n';
  const r = gsi.install(cfg, [main, path.join(t, 'gibtsnicht')]);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.paths, [path.join(fs.realpathSync(cs(extra)), gsi.FILE)]);
  assert.equal(fs.readFileSync(r.paths[0], 'utf8'), cfg, 'Inhalt unverändert von der Website');
});

test('GSI: kein CS2 gefunden', () => {
  const r = gsi.install('"BRTWRST Beamer"\n', [path.join(os.tmpdir(), 'nichts-' + Date.now())]);
  assert.equal(r.ok, false); assert.match(r.error, /nicht gefunden/);
});

test('GSI: Aktualisieren ändert nur vorhandene Dateien', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const cs = lib => path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  const a = path.join(t, 'A'), b = path.join(t, 'B');
  fs.mkdirSync(cs(a), { recursive: true }); fs.mkdirSync(cs(b), { recursive: true });
  const fa = path.join(cs(a), gsi.FILE), alt = '"BRTWRST Beamer"\n{\n  "uri" "https://brat.wurst.pw/lan/gsi.php"\n}\n';
  const neu = '"BRTWRST Beamer"\n{\n  "uri" "http://192.168.1.5:3080/"\n}\n';
  fs.writeFileSync(fa, alt);
  let r = gsi.update(neu, [a, b]);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.updated, [path.join(fs.realpathSync(cs(a)), gsi.FILE)]);
  assert.equal(fs.readFileSync(fa, 'utf8'), neu);
  assert.equal(fs.existsSync(path.join(cs(b), gsi.FILE)), false, 'ohne Datei bleibt die Bibliothek unberührt');
  r = gsi.update(neu, [a, b]);
  assert.deepEqual([r.updated, r.unchanged], [[], 1], 'gleicher Inhalt → nichts schreiben');
});

test('GSI: Entfernen löscht nur unsere Datei', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const d = path.join(t, 'A', 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, gsi.FILE), 'x'); fs.writeFileSync(path.join(d, 'gamestate_integration_anderes.cfg'), 'y');
  let r = gsi.remove([path.join(t, 'A')]);
  assert.deepEqual([r.ok, r.removed.length], [true, 1]);
  assert.deepEqual(fs.readdirSync(d), ['gamestate_integration_anderes.cfg']);
  r = gsi.remove([path.join(t, 'A')]);
  assert.deepEqual(r, { ok: true, removed: [] });
});
