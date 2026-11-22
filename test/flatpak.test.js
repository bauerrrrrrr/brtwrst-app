// D-Bus-Client und Flatpak-Update gegen einen eigenen Session-Bus mit nachgebautem Portal (ohne Fremdpakete).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bus, T, encodeMessage, decodeMessage, splitSig } = require('../src/dbus');
const flatpak = require('../src/flatpak');
const updater = require('../src/updater');

test('Signaturen zerlegen', () => {
  assert.deepStrictEqual(splitSig('sa{sv}'), ['s', 'a{sv}']);
  assert.deepStrictEqual(splitSig('a(yv)ua{s(ii)}'), ['a(yv)', 'u', 'a{s(ii)}']);
});

test('Nachricht hin und zurück', () => {
  const buf = encodeMessage({ type: 4, serial: 7, path: '/a/b', iface: 'x.Y', member: 'Progress', sig: 'a{sv}sb',
    body: [{ status: ['u', 2], progress: ['u', 100], error_message: ['s', 'äh'] }, 'text', true] });
  const { msg, size } = decodeMessage(Buffer.concat([buf, Buffer.from('rest')]));
  assert.strictEqual(size, buf.length);
  assert.strictEqual(msg.member, 'Progress');
  assert.deepStrictEqual(msg.body, [{ status: 2, progress: 100, error_message: 'äh' }, 'text', true]);
  assert.strictEqual(decodeMessage(buf.subarray(0, buf.length - 1)), null);
});

test('Updater erkennt Flatpak', () => {
  const old = process.env.FLATPAK_ID;
  process.env.FLATPAK_ID = flatpak.APP_ID;
  try { if (process.platform === 'linux') assert.deepStrictEqual(updater.target(), { key: null, mode: 'flatpak' }); }
  finally { if (old === undefined) delete process.env.FLATPAK_ID; else process.env.FLATPAK_ID = old; }
});

// ---------- gegen echten dbus-daemon ----------
let haveDaemon = true;
try { execFileSync('dbus-daemon', ['--version'], { stdio: 'ignore' }); } catch { haveDaemon = false; }

async function withPortal(behaviour, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brtwrst-dbus-'));
  const sockPath = path.join(dir, 'bus');
  const cfg = path.join(dir, 'session.conf');
  fs.writeFileSync(cfg, `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:path=${sockPath}</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`);
  const daemon = spawn('dbus-daemon', ['--config-file', cfg, '--nofork', '--print-address'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let bus;
  try {
    const addr = await new Promise(r => daemon.stdout.once('data', d => r(d.toString().trim())));
    // Nachgebautes Portal mit dem eigenen D-Bus-Client (src/dbus.js): Methodenaufrufe selbst beantworten.
    bus = await Bus.connect(addr);
    const calls = [];
    const send = m => bus.sock.write(encodeMessage({ serial: ++bus.serial, ...m }));
    const reply = (msg, sig = '', body = []) => send({ type: T.RETURN, replySerial: msg.serial, dest: msg.sender, sig, body });
    const handle = msg => {
      if (msg.member === 'CreateUpdateMonitor') { calls.push('Create'); reply(msg, 'o', [MONITOR]); }
      else if (msg.member === 'Update') {
        calls.push('Update'); reply(msg);
        setTimeout(() => {
          for (const ev of behaviour) send({ type: T.SIGNAL, path: MONITOR, iface: 'org.freedesktop.portal.Flatpak.UpdateMonitor', member: 'Progress', sig: 'a{sv}',
            body: [Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, [typeof v === 'string' ? 's' : 'u', v]]))] });
        }, 50);
      } else if (msg.member === 'Close') { calls.push('Close'); reply(msg); }
    };
    let buf = Buffer.alloc(0);
    bus.sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      let m;
      while ((m = decodeMessage(buf))) { buf = buf.subarray(m.size); if (m.msg.type === T.CALL) handle(m.msg); }
    });
    await bus.call({ dest: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', iface: 'org.freedesktop.DBus', member: 'RequestName', sig: 'su', body: ['org.freedesktop.portal.Flatpak', 0] });
    await fn(addr, calls);
  } finally { bus?.close(); daemon.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const MONITOR = '/org/freedesktop/portal/Flatpak/update_monitor/1/0';

test('Flatpak-Update über das Portal: erfolgreich', { skip: !haveDaemon && 'dbus-daemon fehlt' }, async () => {
  await withPortal([{ status: 0, progress: 10 }, { status: 0, progress: 60 }, { status: 2, progress: 100 }], async (addr, calls) => {
    const seen = [];
    const r = await flatpak.update(p => seen.push(p), { addr, timeoutMs: 5000 });
    assert.strictEqual(r, 'done');
    assert.deepStrictEqual(seen, [10, 60, 100]);
    assert.deepStrictEqual(calls, ['Create', 'Update', 'Close']);
  });
});

test('Flatpak-Update: nichts Neues im Repo', { skip: !haveDaemon && 'dbus-daemon fehlt' }, async () => {
  await withPortal([{ status: 1 }], async addr => {
    assert.strictEqual(await flatpak.update(() => {}, { addr, timeoutMs: 5000 }), 'empty');
  });
});

test('Flatpak-Update: Fehler mit Meldung', { skip: !haveDaemon && 'dbus-daemon fehlt' }, async () => {
  await withPortal([{ status: 0, progress: 5 }, { status: 3, error: 'org.freedesktop.portal.Error.Failed', error_message: 'Neue Rechte nötig' }], async addr => {
    await assert.rejects(flatpak.update(() => {}, { addr, timeoutMs: 5000 }), /Neue Rechte nötig/);
  });
});
