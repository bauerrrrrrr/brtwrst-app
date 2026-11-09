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

/** A2S_PLAYER-Antwort (0x44) lesen → [{ name, score, time }] (Score ist bei CS meist die Kill-Zahl) */
function parsePlayers(d) {
  if (d.length < 6 || d[4] !== 0x44) return null;
  const out = []; let o = 6;
  for (let i = 0; i < d[5] && o < d.length; i++) {
    o += 1;   // Index
    const z = d.indexOf(0, o); if (z < 0 || z + 9 > d.length) break;
    const name = d.toString('utf8', o, z); o = z + 1;
    const score = d.readInt32LE(o), time = d.readFloatLE(o + 4); o += 8;
    if (name) out.push({ name, score, time: Math.round(time) });
  }
  return out;
}

/** Spielerliste eines Servers per A2S_PLAYER (ohne Passwort, wie früher HLSW). */
function a2sPlayers(addr, { wait = 1500 } = {}) {
  const [host, port] = addr.split(':');
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const end = v => { if (done) return; done = true; clearTimeout(t); try { sock.close(); } catch {} resolve(v); };
    const t = setTimeout(() => end({ ok: false, players: [], error: 'Keine Antwort' }), wait);
    const ask = ch => sock.send(Buffer.concat([Buffer.from([255, 255, 255, 255, 0x55]), ch]), +port, host);
    sock.on('error', e => end({ ok: false, players: [], error: e.message }));
    sock.on('message', d => {
      if (d.length >= 9 && d[4] === 0x41) { ask(d.subarray(5, 9)); return; }
      const p = parsePlayers(d); if (p) end({ ok: true, players: p });
    });
    sock.bind(0, () => ask(Buffer.from([255, 255, 255, 255])));
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

module.exports = { scan, a2s, a2sPlayers, parsePlayers, parseMaps };
