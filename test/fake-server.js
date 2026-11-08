// Simulierter CS2-Server für Tests: RCON (TCP) und A2S_INFO (UDP).
'use strict';
const net = require('net');
const dgram = require('dgram');
const { packet } = require('../src/rcon');

/** RCON-Server. echo: Endmarker-Paket spiegeln (wie Source); silentSet: auf cvar-Setzen gar nicht antworten. */
function rconServer({ password = '147', echo = true, silentSet = false, maps = [], players = [], bans = [], unknown = [] } = {}) {
  const cvars = { game_mode: '0', game_type: '0', mp_maxrounds: '24' };
  const known = n => !unknown.includes(n);
  const log = [];
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0), authed = false;
    const send = (id, type, body) => sock.write(packet(id, type, body));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0), id = buf.readInt32LE(4), type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + len - 2);
        buf = buf.subarray(4 + len);
        if (type === 3) { authed = body === password; send(id, 0, ''); send(authed ? id : -1, 2, ''); continue; }
        if (!authed) { sock.destroy(); return; }
        if (type === 0) { if (echo) { send(id, 0, ''); send(id, 0, '\0\0\0\x01\0\0\0\0'); } continue; }
        log.push(body);
        const [name, ...rest] = body.split(' ');
        const isCvar = /^(?:mp|sv|ammo|spec|tv)_\w+$|^game_(?:type|mode)$|^bot_quota$/.test(name) && known(name);
        const show = (k, v) => /^(mp_match_can_clinch|mp_friendlyfire|mp_halftime|sv_voiceenable|mp_autokick)$/.test(k) ? (v === '1' ? 'true' : v === '0' ? 'false' : v)
          : /^\d+\.\d+$/.test(v) ? Number(v).toFixed(6) : v;
        if (body === 'status') {
          send(id, 0, 'Server:  Running [0.0.0.0:27015]\n---------players--------\n  id     time ping loss      state   rate adr name\n65535 [NoChan]    0    0 challenging      0unknown \'\'\n' +
            players.map(p => `${String(p.id).padStart(6)}    04:04 ${String(p.ping).padStart(4)}    0     active 786432 10.10.100.${30 + p.id}:27005 '${p.name}'`).join('\n') + '\n#end');
        } else if (name === 'kickid') { const i = players.findIndex(p => String(p.id) === rest[0]); if (i >= 0) players.splice(i, 1); send(id, 0, ''); }
        else if (name === 'listid') send(id, 0, `ID filter list: ${bans.length} entries\n` + bans.map((b, i) => `${i + 1} ${b} : permanent`).join('\n'));
        else if (name === 'removeid') { const i = bans.indexOf(rest[0]); if (i >= 0) bans.splice(i, 1); send(id, 0, ''); }
        else if (name === 'writeid') send(id, 0, '');
        else if (isCvar && rest.length) { cvars[name] = rest.join(' '); if (!silentSet) send(id, 0, ''); }
        else if (isCvar) send(id, 0, name in cvars ? `${name} = ${show(name, cvars[name])}` : `Unknown command '${name}'!`);
        else if (body === 'maps *') {
          const text = maps.map(m => '  ' + m).join('\n') + '\n';
          for (let i = 0; i < text.length; i += 4000) send(id, 0, text.slice(i, i + 4000));   // mehrere volle Pakete
        } else if (name === 'say') send(id, 0, `[All Chat][Console (0)]: ${rest.join(' ')}`);
        else send(id, 0, `Unknown command '${name}'!`);
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, log, cvars, players, bans, close: () => srv.close() })));
}

/** A2S-Server mit Challenge (wie CS2). */
function a2sServer(name, { challenge = true, port = 0 } = {}) {
  const s = dgram.createSocket('udp4');
  s.on('message', (d, r) => {
    if (challenge && d.length < 29) { s.send(Buffer.from([255, 255, 255, 255, 0x41, 1, 2, 3, 4]), r.port, r.address); return; }
    s.send(Buffer.concat([Buffer.from([255, 255, 255, 255, 0x49, 0x11]), Buffer.from(name + '\0de_dust2\0csgo\0Counter-Strike 2\0')]), r.port, r.address);
  });
  return new Promise(res => s.bind(port, '127.0.0.1', () => res({ port: s.address().port, close: () => s.close() })));
}

module.exports = { rconServer, a2sServer };
