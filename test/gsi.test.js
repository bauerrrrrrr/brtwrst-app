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
  const r = gsi.install('https://lan.brat.wurst.pw/gsi.php', 'geheim123', [main, path.join(t, 'gibtsnicht')]);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.paths, [path.join(fs.realpathSync(cs(extra)), gsi.FILE)]);
  const c = fs.readFileSync(r.paths[0], 'utf8');
  assert.match(c, /"uri"\s+"https:\/\/lan\.brat\.wurst\.pw\/gsi\.php"/);
  assert.match(c, /"token" "geheim123"/);
  assert.match(c, /"player_state" "1"/);
});

test('GSI: kein CS2 gefunden', () => {
  const r = gsi.install('https://x/gsi.php', 'geheim123', [path.join(os.tmpdir(), 'nichts-' + Date.now())]);
  assert.equal(r.ok, false); assert.match(r.error, /nicht gefunden/);
});
