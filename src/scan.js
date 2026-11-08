// LAN-Scan: A2S_INFO per UDP an alle Server gleichzeitig (mit Challenge-Antwort), danach Mappool per RCON
// von einem gefundenen Server (Passwort = Hausnummer am Ende des Servernamens; Mappool ist überall gleich).
'use strict';
const dgram = require('dgram');
const rcon = require('./rcon');

const QUERY = Buffer.concat([Buffer.from([255, 255, 255, 255, 0x54]), Buffer.from('Source Engine Query\0', 'ascii')]);

/** @param {[string, string][]} list [id, "ip:port"] @returns {Promise<Record<string,string>>} id → Servername */
function a2s(list, { wait = 3000 } = {}) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const ids = new Map(), found = {};
    const end = () => { clearTimeout(t); try { sock.close(); } catch {} resolve(found); };
    const t = setTimeout(end, wait);
    sock.on('error', end);
    sock.on('message', (d, r) => {
      const id = ids.get(`${r.address}:${r.port}`); if (id === undefined) return;
      if (d.length >= 9 && d[4] === 0x41) { sock.send(Buffer.concat([QUERY, d.subarray(5, 9)]), r.port, r.address); return; }
      if (d.length > 6 && d[4] === 0x49) {
        const z = d.indexOf(0, 6);
        if (z > 6) found[id] = d.toString('utf8', 6, z);
        if (Object.keys(found).length === ids.size) end();
      }
    });
    sock.bind(0, () => {
      for (const [id, addr] of list) {
        const [host, port] = addr.split(':');
        ids.set(`${host}:${+port}`, String(id));
        sock.send(QUERY, +port, host);
      }
    });
  });
}

const MAP_RE = /^(de|cs|ar|dz|gd)_[a-z0-9_]+$/;

/** Mappool aus der Ausgabe von „maps *“: eine Map pro Zeile, ohne Skyboxen, _vanity und Editor-Szenen. */
function parseMaps(out) {
  return [...new Set(out.split(/\r?\n/).map(l => l.trim()).filter(l => MAP_RE.test(l) && !/_vanity$|skybox/.test(l)))].sort();
}

async function scan(list) {
  const names = await a2s(list);
  let maps = [];
  const addrOf = Object.fromEntries(list.map(([id, a]) => [String(id), a]));
  let tries = 0;
  for (const id of Object.keys(names).sort((a, b) => a - b)) {
    const pw = (names[id].match(/(\d{2,3})\s*$/) || [])[1];
    if (!pw) continue;
    const [host, port] = addrOf[id].split(':');
    const r = await rcon.run(host, +port, pw, ['maps *'], { timeout: 3000 });
    if (r.ok) { maps = parseMaps(r.results[0].out); break; }   // ein Server reicht
    if (++tries >= 3) break;
  }
  return { names, maps };
}

module.exports = { scan, a2s, parseMaps };
