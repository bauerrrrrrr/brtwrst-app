'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const { createRelay } = require('../src/relay');

const TOKEN = 'testtoken123';
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// Nachgebaute Website: nimmt POSTs an gsi.php an und merkt sie sich.
async function fakeSite(status = 200) {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.writeHead(site.status); res.end(); });
  });
  const site = { got, status, srv };
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  site.url = `http://127.0.0.1:${srv.address().port}/lan/gsi.php`;
  return site;
}

// Wie CS2: eine Meldung per POST an den Relay.
const send = (port, body) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end(data);
});
const msg = (steam, round, token = TOKEN) => ({ provider: { steamid: steam, name: `P${steam}` }, map: { round }, auth: { token } });

async function setup(siteStatus) {
  const site = await fakeSite(siteStatus), port = await freePort();
  const relay = createRelay({ token: TOKEN, port, host: '127.0.0.1', uri: `http://192.168.1.5:${port}/`, target: site.url, interval: 3600000 });
  await relay.start();
  await new Promise(r => setTimeout(r, 50));   // erste Meldung beim Start (Keepalive) abwarten
  return { site, port, relay, done: async () => { await relay.stop(); site.srv.close(); } };
}

test('Relay: meldet sich beim Start mit leerem Bündel und eigener Adresse', async () => {
  const { site, port, done } = await setup();
  assert.equal(site.got.length, 1);
  assert.deepEqual(site.got[0], { auth: { token: TOKEN }, relay: `http://192.168.1.5:${port}/`, batch: [] });
  await done();
});

test('Relay: mehrere Spieler → ein Bündel, Reihenfolge bleibt, Schlüssel nur einmal', async () => {
  const { site, port, relay, done } = await setup();
  for (const [s, r] of [['1', 1], ['2', 1], ['1', 2], ['3', 1]]) assert.equal(await send(port, msg(s, r)), 200);
  await relay.flush();
  const b = site.got.at(-1);
  assert.equal(site.got.length, 2, 'eine Anfrage für alle Meldungen');
  assert.deepEqual(b.batch.map(x => [x.m.provider.steamid, x.m.map.round]), [['1', 1], ['2', 1], ['1', 2], ['3', 1]]);
  assert.ok(b.batch.every(x => x.m.auth === undefined && Number.isInteger(x.age_ms) && x.age_ms >= 0));
  const st = relay.status();
  assert.equal(st.forwarded, 4); assert.equal(st.queue, 0); assert.deepEqual(Object.keys(st.senders).sort(), ['1', '2', '3']);
  await relay.flush();
  assert.equal(site.got.length, 2, 'ohne neue Meldungen keine weitere Anfrage');
  await done();
});

test('Relay: falscher Schlüssel, kaputtes JSON und GET werden abgewiesen', async () => {
  const { site, port, relay, done } = await setup();
  assert.equal(await send(port, msg('1', 1, 'falsch')), 403);
  assert.equal(await send(port, msg('1', 1, null)), 403);
  assert.equal(await send(port, '{kaputt'), 400);
  assert.equal(await new Promise(r => http.get({ host: '127.0.0.1', port }, res => { res.resume(); r(res.statusCode); })), 405);
  await relay.flush();
  assert.equal(site.got.length, 1, 'nichts weitergeleitet');
  assert.equal(relay.status().rejected, 3);
  await done();
});

test('Relay: Website nicht erreichbar → letzte Meldung je Spieler bleibt, wird später nachgeliefert', async () => {
  const { site, port, relay, done } = await setup();
  site.status = 503;
  for (const [s, r] of [['1', 1], ['2', 1], ['1', 2]]) await send(port, msg(s, r));
  await relay.flush();
  let st = relay.status();
  assert.equal(st.lastError, 'HTTP 503'); assert.equal(st.queue, 2, 'nur die jüngste Meldung je Spieler');
  await relay.flush();
  assert.equal(site.got.length, 2, 'während des Backoffs keine neue Anfrage');
  site.status = 200;
  await new Promise(r => setTimeout(r, 2100));
  await relay.flush();
  assert.deepEqual(site.got.at(-1).batch.map(x => [x.m.provider.steamid, x.m.map.round]), [['2', 1], ['1', 2]]);
  st = relay.status(); assert.equal(st.lastError, ''); assert.equal(st.queue, 0);
  await done();
});

test('Relay: belegter Port → Fehler beim Start', async () => {
  const { port, done } = await setup();
  const other = createRelay({ token: TOKEN, port, host: '127.0.0.1', uri: 'http://192.168.1.5/', target: 'http://127.0.0.1:1/', interval: 3600000 });
  await assert.rejects(other.start(), { code: 'EADDRINUSE' });
  await done();
});
