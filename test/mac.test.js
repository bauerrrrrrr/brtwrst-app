// macOS-Update: .app aus dem ZIP gegen die laufende tauschen (Entpacken simuliert, ditto gibt es nur auf dem Mac).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { swapMacApp, macAppPath } = require('../src/updater');

const mkApp = (dir, ver) => { const p = path.join(dir, 'BRTWRST.app', 'Contents', 'MacOS'); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'BRTWRST'), ver); return path.join(dir, 'BRTWRST.app'); };

test('Pfad der laufenden .app', () => {
  assert.strictEqual(macAppPath('/Applications/BRTWRST.app/Contents/MacOS/BRTWRST'), '/Applications/BRTWRST.app');
  assert.strictEqual(macAppPath('/usr/bin/node'), null);
});

test('.app tauschen, alte als alt.app behalten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brtwrst-mac-'));
  const apps = path.join(root, 'Programme'), work = path.join(root, 'updates');
  fs.mkdirSync(apps); fs.mkdirSync(work);
  const current = mkApp(apps, 'alt');
  const zip = path.join(work, 'BRTWRST-0.1.2-mac-arm64.zip'); fs.writeFileSync(zip, 'zip');
  const res = swapMacApp(zip, current, work, (z, d) => mkApp(d, 'neu'));
  assert.strictEqual(res, current);
  assert.strictEqual(fs.readFileSync(path.join(current, 'Contents/MacOS/BRTWRST'), 'utf8'), 'neu');
  assert.strictEqual(fs.readFileSync(path.join(work, 'alt.app/Contents/MacOS/BRTWRST'), 'utf8'), 'alt');
  assert.ok(!fs.existsSync(zip) && !fs.existsSync(path.join(work, 'neu')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('ZIP ohne .app: nichts kaputt machen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brtwrst-mac-'));
  const current = mkApp(root, 'alt');
  const zip = path.join(root, 'u.zip'); fs.writeFileSync(zip, 'zip');
  assert.throws(() => swapMacApp(zip, current, root, () => {}), /keine \.app/);
  assert.strictEqual(fs.readFileSync(path.join(current, 'Contents/MacOS/BRTWRST'), 'utf8'), 'alt');
  fs.rmSync(root, { recursive: true, force: true });
});
