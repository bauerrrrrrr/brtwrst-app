// Source-RCON-Client (TCP), wie ihn CS2 spricht. Eine Verbindung pro Auftrag, mehrere Befehle nacheinander.
// Paket: int32 Länge, int32 ID, int32 Typ, Text + \0, \0 (Little Endian).
'use strict';
const net = require('net');

const AUTH = 3, AUTH_RESPONSE = 2, EXEC = 2, RESPONSE_VALUE = 0;

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const p = Buffer.alloc(14 + b.length);
  p.writeInt32LE(10 + b.length, 0);
  p.writeInt32LE(id, 4);
  p.writeInt32LE(type, 8);
  b.copy(p, 12);
  return p;   // die zwei Null-Bytes am Ende sind durch Buffer.alloc schon da
}

/**
 * Führt Befehle per RCON aus.
 * @returns {Promise<{ok: boolean, results: {cmd: string, out: string}[], error?: string}>}
 */
const FULL = 3800;   // ab dieser Textlänge gilt ein Paket als „voll“, es kann mehr folgen

function run(host, port, password, cmds, { timeout = 5000, idle = 400, quiet = 1500 } = {}) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host, port });
    const results = [];
    let buf = Buffer.alloc(0), id = 100, waiting = null, done = false;
    const finish = (ok, error) => {
      if (done) return; done = true;
      clearTimeout(timer); sock.destroy();
      resolve(ok ? { ok, results } : { ok, results, error });
    };
    let timer = setTimeout(() => finish(false, 'Zeitüberschreitung'), timeout);
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => finish(false, 'Zeitüberschreitung'), timeout); };

    // Antworten sammeln. Lange Antworten kommen in mehreren vollen Paketen (~4 KB). Ende einer Antwort ist:
    // ein nicht volles Paket, das Echo eines leeren Markierungspakets, das wir hinterherschicken, oder eine kurze
    // Ruhepause. Schickt der Server gar nichts (manche cvar-Befehle), endet das Warten nach `quiet` ms.
    function expect(kind, cmdId, markId) {
      return new Promise((res, rej) => {
        waiting = { kind, cmdId, markId, text: '', res, rej, idleT: null };
        if (kind === 'exec') { const w = waiting; w.idleT = setTimeout(() => waiting === w && settle(w.text), quiet); }
      });
    }
    function settle(text) { const w = waiting; waiting = null; clearTimeout(w.idleT); w.res(text); }
    function onPacket(pid, type, body) {
      const w = waiting; if (!w) return;
      if (w.kind === 'auth') {
        if (type === AUTH_RESPONSE) { if (pid === -1) { waiting = null; w.rej(new Error('Passwort falsch')); } else settle(''); }
        return;
      }
      if (pid === w.markId) { settle(w.text); return; }
      if (pid === w.cmdId && type === RESPONSE_VALUE) {
        w.text += body;
        if (Buffer.byteLength(body) < FULL) { settle(w.text); return; }
        clearTimeout(w.idleT); w.idleT = setTimeout(() => waiting === w && settle(w.text), idle);
      }
    }
    sock.on('data', d => {
      bump();
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (len < 10 || len > 1 << 20) { finish(false, 'Ungültige Antwort vom Server'); return; }
        if (buf.length < 4 + len) break;
        const pid = buf.readInt32LE(4), type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + len - 2);
        buf = buf.subarray(4 + len);
        onPacket(pid, type, body);
      }
    });
    sock.on('error', e => finish(false, e.code === 'ECONNREFUSED' ? 'Verbindung abgelehnt (RCON aus oder falscher Port?)' : e.message));
    sock.on('close', () => { if (waiting) { const w = waiting; waiting = null; w.rej(new Error('Verbindung vom Server getrennt')); } });
    sock.on('connect', async () => {
      try {
        const authId = ++id;
        const p = expect('auth');
        sock.write(packet(authId, AUTH, password));
        await p;
        for (const cmd of cmds) {
          const cmdId = ++id, markId = ++id;
          const q = expect('exec', cmdId, markId);
          sock.write(packet(cmdId, EXEC, cmd));
          sock.write(packet(markId, RESPONSE_VALUE, ''));
          results.push({ cmd, out: (await q).replace(/\s+$/, '') });
        }
        finish(true);
      } catch (e) { finish(false, e.message); }
    });
  });
}

module.exports = { run, packet };
