// GSI-Relay: nimmt im LAN die GSI-Meldungen aller Spieler an und schickt sie gebündelt (etwa 1 Anfrage pro Sekunde)
// an die Website (gsi.php). So sieht der Hoster nur noch eine Anfrage pro Sekunde statt einer je Spieler und Meldung.
'use strict';
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { isLanAddr } = require('./guard');

const MAX_BODY = 200000;      // wie gsi.php für eine einzelne Meldung
const MAX_QUEUE = 2000;       // darüber nur noch die letzte Meldung je Spieler behalten
const MAX_BATCH = 400;        // Meldungen je Weiterleitung
const KEEPALIVE_MS = 30000;   // ohne Meldungen meldet sich der Relay so oft bei der Website (Adresse bleibt aktuell)

/** Eigene LAN-IPv4-Adressen dieses PCs (ohne 127/8). */
function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isLanAddr(`${a.address}:1`) && !a.address.startsWith('127.')) out.push(a.address);
  }
  return [...new Set(out)];
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/**
 * opts: { token, port, host = '0.0.0.0', uri (wird der Website als Ziel gemeldet), target (URL von gsi.php),
 *         interval = 1000, fetch = globalThis.fetch }
 */
function createRelay(opts) {
  const { token, port, host = '0.0.0.0', uri, target, interval = 1000 } = opts;
  const doFetch = opts.fetch || globalThis.fetch;
  let queue = [], server = null, timer = null, busy = false, backoff = 0, waitUntil = 0, lastSent = 0;
  const st = { received: 0, rejected: 0, forwarded: 0, batches: 0, lastOk: 0, lastError: '', senders: {} };

  // Bei Stau nur die jüngste Meldung je Spieler behalten; Reihenfolge bleibt.
  const compact = () => {
    const last = new Map();
    queue.forEach((q, i) => last.set(q.steam, i));
    queue = queue.filter((q, i) => last.get(q.steam) === i).slice(-MAX_QUEUE);
  };

  const onRequest = (req, res) => {
    const done = code => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(); };
    if (req.method !== 'POST') return done(405);
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { tooBig = true; req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return;
      let m;
      try { m = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { st.rejected++; return done(400); }
      if (!m || typeof m !== 'object' || !same(m.auth?.token ?? '', token)) { st.rejected++; return done(403); }
      delete m.auth;   // der Schlüssel geht einmal je Bündel mit, nicht je Meldung
      const steam = String(m.provider?.steamid ?? '');
      st.received++;
      if (steam) st.senders[steam] = { name: String(m.provider?.name ?? m.player?.name ?? ''), ts: Date.now() };
      queue.push({ at: Date.now(), steam, m });
      if (queue.length > MAX_QUEUE) compact();
      done(200);
    });
    req.on('error', () => {});
  };

  async function flush() {
    const now = Date.now();
    if (busy || now < waitUntil) return;
    if (!queue.length && now - lastSent < KEEPALIVE_MS) return;
    busy = true;
    const batch = queue.slice(0, MAX_BATCH);
    const body = JSON.stringify({ auth: { token }, relay: uri, batch: batch.map(q => ({ age_ms: now - q.at, m: q.m })) });
    try {
      const r = await doFetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      queue = queue.slice(batch.length);
      st.forwarded += batch.length; st.batches++; st.lastOk = Date.now(); st.lastError = ''; backoff = 0;
    } catch (e) {
      st.lastError = e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message;
      backoff = Math.min(30000, backoff ? backoff * 2 : 2000); waitUntil = Date.now() + backoff;
      compact();
    }
    lastSent = Date.now();
    busy = false;
  }

  return {
    start: () => new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      server.on('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject); server.on('error', () => {});
        timer = setInterval(flush, interval); flush();
        resolve();
      });
    }),
    stop: () => new Promise(resolve => {
      clearInterval(timer); timer = null;
      if (!server) return resolve();
      server.close(() => resolve()); server.closeAllConnections?.(); server = null;
    }),
    flush,
    status: () => ({ on: !!server, uri, port, queue: queue.length, ...st, senders: { ...st.senders } }),
  };
}

module.exports = { createRelay, lanAddrs };
