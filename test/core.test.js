'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rcon = require('../src/rcon');
const { scan, parseMaps } = require('../src/scan');
const { isOwn, isLanAddr, validCmds } = require('../src/guard');
const { rconServer, a2sServer } = require('./fake-server');

const MAPS = ['ar_baggage', 'cs_italy', 'de_dust2', 'de_fachwerk', 'de_mirage', 'de_dust2_vanity', 'maps/editor/x', 'de_dust2_skybox'];

test('RCON: Befehle, Antworten, Werte setzen', async () => {
  const s = await rconServer();
  const r = await rcon.run('127.0.0.1', s.port, '147', ['game_type 0', 'game_mode 1', 'game_mode', 'say LIVE', 'gibtsnicht']);
  s.close();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.results.map(x => x.out), ['', '', 'game_mode = 1', '[All Chat][Console (0)]: LIVE', "Unknown command 'gibtsnicht'!"]);
  assert.deepEqual(s.log, ['game_type 0', 'game_mode 1', 'game_mode', 'say LIVE', 'gibtsnicht']);
});

test('RCON: falsches Passwort', async () => {
  const s = await rconServer();
  const r = await rcon.run('127.0.0.1', s.port, 'falsch', ['game_mode']);
  s.close();
  assert.equal(r.ok, false);
  assert.match(r.error, /Passwort falsch/);
});

test('RCON: lange Antwort über mehrere Pakete (mit und ohne Echo)', async () => {
  const many = Array.from({ length: 900 }, (_, i) => 'de_map' + i);
  for (const echo of [true, false]) {
    const s = await rconServer({ echo, maps: many });
    const r = await rcon.run('127.0.0.1', s.port, '147', ['maps *', 'game_mode']);
    s.close();
    assert.equal(r.ok, true, r.error);
    assert.equal(r.results[0].out.split('\n').length, 900, `echo=${echo}`);
    assert.equal(r.results[1].out, 'game_mode = 0');
  }
});

test('RCON: 59 Config-Befehle zügig, auch ohne Echo', async () => {
  const cmds = Array.from({ length: 59 }, (_, i) => (i % 2 ? 'game_mode ' : 'game_type ') + (i % 3));
  const s = await rconServer({ echo: false });
  const t0 = Date.now();
  const r = await rcon.run('127.0.0.1', s.port, '147', cmds);
  s.close();
  assert.equal(r.ok, true, r.error);
  assert.ok(Date.now() - t0 < 2000, `dauerte ${Date.now() - t0} ms`);
});

test('RCON: Server antwortet auf Setzen gar nicht -> Wartezeit begrenzt', async () => {
  const s = await rconServer({ echo: false, silentSet: true });
  const t0 = Date.now();
  const r = await rcon.run('127.0.0.1', s.port, '147', ['game_mode 1', 'game_mode'], { quiet: 300 });
  s.close();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.results[1].out, 'game_mode = 1');
  assert.ok(Date.now() - t0 < 1500);
});

test('RCON: Verbindung abgelehnt', async () => {
  const r = await rcon.run('127.0.0.1', 1, '147', ['game_mode']);
  assert.equal(r.ok, false);
  assert.match(r.error, /abgelehnt/);
});

test('Mappool aus „maps *“', () => {
  assert.deepEqual(parseMaps(MAPS.map(m => '  ' + m).join('\n')), ['ar_baggage', 'cs_italy', 'de_dust2', 'de_fachwerk', 'de_mirage']);
});

test('Scan: Namen per A2S, Mappool per RCON vom ersten Server', async () => {
  const s = await rconServer({ password: '147', maps: MAPS });
  // wie beim echten Server: A2S (UDP) und RCON (TCP) auf demselben Port. Server 1 hat kein RCON, 2 antwortet gar nicht.
  const a = await a2sServer('1 MTA Haus 56'), b = await a2sServer('23 MTA Haus 147', { challenge: false, port: s.port });
  const list = [['1', `127.0.0.1:${a.port}`], ['23', `127.0.0.1:${b.port}`], ['2', '127.0.0.1:9']];
  const r = await scan(list);
  a.close(); b.close(); s.close();
  assert.deepEqual(r.names, { 1: '1 MTA Haus 56', 23: '23 MTA Haus 147' });
  assert.deepEqual(r.maps, ['ar_baggage', 'cs_italy', 'de_dust2', 'de_fachwerk', 'de_mirage']);
});

test('Absicherung: Domain, LAN-Adressen, Befehle', () => {
  assert.equal(isOwn('https://lan.brat.wurst.pw/index.php?p=rcon'), true);
  assert.equal(isOwn('https://brat.wurst.pw/lan/index.php?p=rcon'), true);
  assert.equal(isOwn('https://brat.wurst.pw/'), false);
  assert.equal(isOwn('https://brat.wurst.pw/lanparty/'), false);
  assert.equal(isOwn('https://brat.wurst.pw/lan'), false);
  assert.equal(isOwn('https://brat.wurst.pw/lan/index.php'), true);
  assert.equal(isOwn('https://brat.wurst.pw/anderes/'), false);
  assert.equal(isOwn('https://lan.brat.wurst.pw.evil.example/'), false);
  assert.equal(isOwn('http://lan.brat.wurst.pw/'), false);
  assert.equal(isOwn('file:///etc/passwd'), false);
  for (const a of ['10.10.100.17:27016', '192.168.1.5:27015', '172.20.0.1:27015', '127.0.0.1:27015']) assert.equal(isLanAddr(a), true, a);
  for (const a of ['8.8.8.8:27015', '172.32.0.1:27015', '10.10.100.17', '10.10.100.300:1', 'evil.com:27015', '10.0.0.1:0']) assert.equal(isLanAddr(a), false, a);
  assert.equal(validCmds(['mp_warmup_end', 'say GL HF']), true);
  assert.equal(validCmds(['say a\nquit']), false);
  assert.equal(validCmds([]), false);
  assert.equal(validCmds('changelevel de_dust2'), false);
});
