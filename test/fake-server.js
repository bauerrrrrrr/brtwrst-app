// Simulierter CS2-Server für Tests: RCON (TCP) und A2S_INFO (UDP).
'use strict';
const net = require('net');
const dgram = require('dgram');
const { packet } = require('../src/rcon');

/** RCON-Server. echo: Endmarker-Paket spiegeln (wie Source); silentSet: auf cvar-Setzen gar nicht antworten. */
function rconServer({ password = '147', echo = true, silentSet = false, maps = [] } = {}) {
  const cvars = { game_mode: '0', game_type: '0', mp_maxrounds: '24' };
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
        if (body === 'maps *') {
          const text = maps.map(m => '  ' + m).join('\n') + '\n';
          for (let i = 0; i < text.length; i += 4000) send(id, 0, text.slice(i, i + 4000));   // mehrere volle Pakete
        } else if (name in cvars && rest.length) { cvars[name] = rest.join(' '); if (!silentSet) send(id, 0, ''); }
        else if (name in cvars) send(id, 0, `${name} = ${cvars[name]}`);
        else if (name === 'say') send(id, 0, `[All Chat][Console (0)]: ${rest.join(' ')}`);
        else send(id, 0, `Unknown command '${name}'!`);
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, log, cvars, close: () => srv.close() })));
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
