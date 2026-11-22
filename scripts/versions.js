#!/usr/bin/env node
// Versionen prüfen (vor jedem Release, siehe CLAUDE.md): alles, was in package.json, den Workflows und im
// Flatpak-Manifest steht, dazu die Website (Leaflet, PHP auf dem Server), gegen die neueste stabile Version.
// Nur lesen, ändert nichts.
//   npm run versions [-- <pfad zu teambratwurst>]   (Standard: ../teambratwurst neben diesem Repo)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const rows = [];
const row = (was, ist, neu, hinweis = '', info = false) => rows.push({ was, ist, neu, ok: (hinweis === '' || info) && String(ist) === String(neu), hinweis });

/** Höchste stabile Version (vX.Y.Z bzw. branch/X.Y) aus den Refs eines Git-Repos. */
function gitRefs(url) {
  return execFileSync('git', ['ls-remote', '--tags', '--heads', url], { encoding: 'utf8', timeout: 30000 })
    .split('\n').map(l => l.split('\t')[1] || '').filter(Boolean);
}
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const max = list => list.sort(cmp).pop();

async function main() {
  // npm-Pakete aus package.json (Abhängigkeiten aller Art)
  const pkg = JSON.parse(read('package.json'));
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    let neu = '?';
    try { neu = execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' }).trim(); } catch {}
    const ist = String(range).replace(/^[\^~>=<\s]+/, '');
    row(`npm ${name}`, ist, neu, neu !== '?' && ist.split('.')[0] !== neu.split('.')[0] ? 'neue Hauptversion' : '');
  }

  // GitHub-Actions (alle uses:-Zeilen) und node-version in den Workflows
  const wf = fs.readdirSync(path.join(root, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)).map(f => read(`.github/workflows/${f}`)).join('\n');
  const actions = new Map();
  for (const m of wf.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@v?(\d+)/g)) actions.set(m[1], new Set([...(actions.get(m[1]) || []), m[2]]));
  for (const [a, used] of actions) {
    let neu = '?';
    try { neu = max(gitRefs(`https://github.com/${a}`).map(r => /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(r)?.[1]).filter(Boolean)).split('.')[0]; } catch {}
    const ist = [...used].join('/');
    row(`Action ${a}`, ist, neu, used.size > 1 ? 'verschiedene Versionen im Einsatz' : '');
  }
  const nodes = new Set([...wf.matchAll(/node-version:\s*['"]?(\d+)/g)].map(m => m[1]));
  let lts = '?';
  try { lts = (await (await fetch('https://nodejs.org/dist/index.json')).json()).find(v => v.lts).version.replace(/^v/, '').split('.')[0]; } catch {}
  row('Node in der CI', [...nodes].join('/'), lts, nodes.size > 1 ? 'verschiedene Versionen im Einsatz' : '');

  // Flatpak: runtime-version/base-version gegen die neueste Electron-BaseApp
  const fp = read('flatpak/pw.wurst.brat.Brtwrst.yml');
  const rt = /runtime-version:\s*'?([\d.]+)/.exec(fp)?.[1], base = /base-version:\s*'?([\d.]+)/.exec(fp)?.[1];
  let br = '?';
  try { br = max(gitRefs('https://github.com/flathub/org.electronjs.Electron2.BaseApp').map(r => /^refs\/heads\/branch\/(\d+\.\d+)$/.exec(r)?.[1]).filter(Boolean)); } catch {}
  row('Flatpak runtime-version', rt, br);
  row('Flatpak base-version', base, br, rt !== base ? 'runtime- und base-version verschieden' : '');

  // Website (teambratwurst): Leaflet (vendored) und PHP auf dem Server (steht von Hand in deren CLAUDE.md)
  const web = path.resolve(process.argv[2] || path.join(root, '..', 'teambratwurst'));
  if (fs.existsSync(path.join(web, 'index.php'))) {
    let ll = '?', neu = '?';
    try { ll = /Leaflet (\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(web, 'assets/vendor/leaflet/leaflet.js'), 'utf8').slice(0, 300))[1]; } catch {}
    try { neu = execFileSync('npm', ['view', 'leaflet', 'version'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' }).trim(); } catch {}
    row('Website Leaflet', ll, neu);
    // Plakat-Werkzeug (tools/posters/package.json: Schriften für make.py/render.js)
    try {
      const pp = JSON.parse(fs.readFileSync(path.join(web, 'tools/posters/package.json'), 'utf8'));
      for (const [name, range] of Object.entries({ ...pp.dependencies, ...pp.devDependencies })) {
        let v = '?';
        try { v = execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' }).trim(); } catch {}
        row(`Website Plakate ${name}`, String(range).replace(/^[\^~>=<\s]+/, ''), v);
      }
    } catch {}
    // PHP: Ziel ist die höchste Version, die Plesk anbietet; beide Werte stehen von Hand in teambratwurst/CLAUDE.md.
    const md = (() => { try { return fs.readFileSync(path.join(web, 'CLAUDE.md'), 'utf8'); } catch { return ''; } })();
    const php = /PHP auf dem Server: (\d+\.\d+\.\d+)/.exec(md)?.[1] || '?', plesk = /Plesk bietet höchstens: (\d+\.\d+\.\d+)/.exec(md)?.[1] || '?';
    let phpNeu = '?';
    try { phpNeu = max(gitRefs('https://github.com/php/php-src').map(r => /^refs\/tags\/php-(\d+\.\d+\.\d+)$/.exec(r)?.[1]).filter(Boolean)); } catch {}
    row('Website PHP (Server/Plesk)', php, plesk, `in Plesk nachsehen und in teambratwurst/CLAUDE.md eintragen; neueste PHP: ${phpNeu}`, true);
  } else row('Website', '–', '–', `nicht gefunden (${web}); Pfad als Argument angeben`);

  const w = Math.max(...rows.map(r => r.was.length));
  for (const r of rows) console.log(`${r.ok ? '  ok ' : 'NEUER'}  ${r.was.padEnd(w)}  ${String(r.ist).padEnd(8)} → ${r.neu}${r.hinweis ? `  (${r.hinweis})` : ''}`);
  const old = rows.filter(r => !r.ok).length;
  console.log(old ? `\n${old} Punkt(e) prüfen: auf die neueste stabile Version gehen oder im Release-Bericht begründen.` : '\nAlles aktuell.');
}
main();
