// Erzeugt manifest.json (+ .sig) für ein Release.
//   node scripts/manifest.js <ordner-mit-dateien> <version> [notizen]
// Signaturschlüssel (Ed25519, PEM) aus der Umgebungsvariable BRTWRST_SIGNING_KEY.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [dir, version, notes = ''] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Aufruf: node scripts/manifest.js <ordner> <version> [notizen]'); process.exit(2); }
const key = process.env.BRTWRST_SIGNING_KEY;
if (!key) { console.error('BRTWRST_SIGNING_KEY fehlt'); process.exit(2); }

const pick = re => { const f = fs.readdirSync(dir).find(n => re.test(n)); return f || null; };
const info = name => {
  if (!name) return undefined;
  const buf = fs.readFileSync(path.join(dir, name));
  return { name, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
};
const files = {
  win: info(pick(new RegExp(`^BRTWRST-${version}-win-.*\\.exe$`))),
  appimage: info(pick(new RegExp(`^BRTWRST-${version}-linux-.*\\.AppImage$`))),
  'mac-arm64': info(pick(new RegExp(`^BRTWRST-${version}-mac-arm64\\.zip$`))),
  'mac-x64': info(pick(new RegExp(`^BRTWRST-${version}-mac-x64\\.zip$`))),
};
for (const k of Object.keys(files)) if (!files[k]) delete files[k];
if (!files.win && !files.appimage) { console.error('Keine Installer im Ordner gefunden'); process.exit(1); }

const raw = JSON.stringify({ version, date: new Date().toISOString(), notes, files }, null, 2);
const sig = crypto.sign(null, Buffer.from(raw), crypto.createPrivateKey(key)).toString('base64');
fs.writeFileSync(path.join(dir, 'manifest.json'), raw);
fs.writeFileSync(path.join(dir, 'manifest.json.sig'), sig + '\n');
console.log(raw);
