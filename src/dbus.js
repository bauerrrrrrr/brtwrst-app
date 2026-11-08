// Kleiner D-Bus-Client (Session-Bus, Unix-Socket) für die wenigen Portal-Aufrufe der App.
// Unterstützt Methodenaufrufe, Antworten, Fehler und Signale; Datentypen: Basistypen, Arrays, Dicts, Structs, Variants.
'use strict';
const net = require('net');
const os = require('os');

const T = { CALL: 1, RETURN: 2, ERROR: 3, SIGNAL: 4 };
const F = { PATH: 1, INTERFACE: 2, MEMBER: 3, ERROR_NAME: 4, REPLY_SERIAL: 5, DESTINATION: 6, SENDER: 7, SIGNATURE: 8 };
const ALIGN = { y: 1, b: 4, n: 2, q: 2, i: 4, u: 4, x: 8, t: 8, d: 8, s: 4, o: 4, g: 1, v: 1, a: 4, '(': 8, '{': 8 };

/** Signatur in einzelne vollständige Typen zerlegen: "sa{sv}" → ["s", "a{sv}"] */
function splitSig(sig) {
  const out = []; let i = 0;
  const one = () => {
    const c = sig[i++];
    if (c === 'a') { one(); return; }
    if (c === '(' || c === '{') { const close = c === '(' ? ')' : '}'; while (sig[i] !== close) { if (i >= sig.length) throw new Error('Signatur kaputt'); one(); } i++; }
  };
  while (i < sig.length) { const s = i; one(); out.push(sig.slice(s, i)); }
  return out;
}

class Writer {
  constructor() { this.parts = []; this.len = 0; }
  push(b) { this.parts.push(b); this.len += b.length; }
  pad(n) { const p = (n - (this.len % n)) % n; if (p) this.push(Buffer.alloc(p)); }
  buf() { return Buffer.concat(this.parts, this.len); }
  write(type, v) {
    const c = type[0];
    this.pad(ALIGN[c]);
    const num = (size, fn) => { const b = Buffer.alloc(size); b[fn](v, 0); this.push(b); };
    switch (c) {
      case 'y': this.push(Buffer.from([v & 255])); break;
      case 'b': v = v ? 1 : 0; num(4, 'writeUInt32LE'); break;
      case 'n': num(2, 'writeInt16LE'); break;
      case 'q': num(2, 'writeUInt16LE'); break;
      case 'i': num(4, 'writeInt32LE'); break;
      case 'u': num(4, 'writeUInt32LE'); break;
      case 'x': { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); this.push(b); break; }
      case 't': { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.push(b); break; }
      case 'd': num(8, 'writeDoubleLE'); break;
      case 's': case 'o': { const s = Buffer.from(String(v)); const l = Buffer.alloc(4); l.writeUInt32LE(s.length); this.push(l); this.push(s); this.push(Buffer.alloc(1)); break; }
      case 'g': { const s = Buffer.from(String(v)); this.push(Buffer.from([s.length])); this.push(s); this.push(Buffer.alloc(1)); break; }
      case 'v': { const [sig, val] = v; this.write('g', sig); this.write(sig, val); break; }
      case '(': { const inner = splitSig(type.slice(1, -1)); inner.forEach((t, k) => this.write(t, v[k])); break; }
      case 'a': {
        const el = type.slice(1);
        const lenAt = this.parts.length; this.push(Buffer.alloc(4));
        this.pad(ALIGN[el[0]]);
        const start = this.len;
        if (el[0] === '{') { const [kt, vt] = splitSig(el.slice(1, -1)); for (const [k, val] of Object.entries(v || {})) { this.pad(8); this.write(kt, k); this.write(vt, val); } }
        else for (const x of v || []) this.write(el, x);
        this.parts[lenAt].writeUInt32LE(this.len - start);
        break;
      }
      default: throw new Error('Typ nicht unterstützt: ' + type);
    }
  }
}

class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  align(n) { this.p += (n - (this.p % n)) % n; }
  read(type) {
    const c = type[0], b = this.b;
    this.align(ALIGN[c]);
    const adv = (n, v) => { this.p += n; return v; };
    switch (c) {
      case 'y': return adv(1, b[this.p]);
      case 'b': return adv(4, b.readUInt32LE(this.p) !== 0);
      case 'n': return adv(2, b.readInt16LE(this.p));
      case 'q': return adv(2, b.readUInt16LE(this.p));
      case 'i': return adv(4, b.readInt32LE(this.p));
      case 'u': return adv(4, b.readUInt32LE(this.p));
      case 'x': return adv(8, Number(b.readBigInt64LE(this.p)));
      case 't': return adv(8, Number(b.readBigUInt64LE(this.p)));
      case 'd': return adv(8, b.readDoubleLE(this.p));
      case 's': case 'o': { const l = b.readUInt32LE(this.p); const s = b.toString('utf8', this.p + 4, this.p + 4 + l); this.p += 5 + l; return s; }
      case 'g': { const l = b[this.p]; const s = b.toString('utf8', this.p + 1, this.p + 1 + l); this.p += 2 + l; return s; }
      case 'v': { const sig = this.read('g'); return this.read(sig); }   // Variant → nur der Wert
      case '(': return splitSig(type.slice(1, -1)).map(t => this.read(t));
      case 'a': {
        const el = type.slice(1), len = b.readUInt32LE(this.p); this.p += 4;
        this.align(ALIGN[el[0]]);
        const end = this.p + len;
        if (el[0] === '{') { const [kt, vt] = splitSig(el.slice(1, -1)); const o = {}; while (this.p < end) { this.align(8); const k = this.read(kt); o[k] = this.read(vt); } return o; }
        const arr = []; while (this.p < end) arr.push(this.read(el)); return arr;
      }
      default: throw new Error('Typ nicht unterstützt: ' + type);
    }
  }
}

function encodeMessage({ type, serial, path, iface, member, dest, errorName, replySerial, sig = '', body = [] }) {
  const bw = new Writer(); splitSig(sig).forEach((t, k) => bw.write(t, body[k]));
  const bodyBuf = bw.buf();
  const fields = [];
  if (path) fields.push([F.PATH, ['o', path]]);
  if (iface) fields.push([F.INTERFACE, ['s', iface]]);
  if (member) fields.push([F.MEMBER, ['s', member]]);
  if (errorName) fields.push([F.ERROR_NAME, ['s', errorName]]);
  if (replySerial) fields.push([F.REPLY_SERIAL, ['u', replySerial]]);
  if (dest) fields.push([F.DESTINATION, ['s', dest]]);
  if (sig) fields.push([F.SIGNATURE, ['g', sig]]);
  const hw = new Writer();
  hw.write('y', 'l'.charCodeAt(0)); hw.write('y', type); hw.write('y', 0); hw.write('y', 1);
  hw.write('u', bodyBuf.length); hw.write('u', serial);
  hw.write('a(yv)', fields);
  hw.pad(8);
  return Buffer.concat([hw.buf(), bodyBuf]);
}

/** Vollständige Nachricht am Anfang von buf? → { msg, size } oder null */
function decodeMessage(buf) {
  if (buf.length < 16) return null;
  if (buf[0] !== 0x6c) throw new Error('Nur Little-Endian-Nachrichten unterstützt');
  const bodyLen = buf.readUInt32LE(4), fieldsLen = buf.readUInt32LE(12);
  const headerEnd = 16 + fieldsLen + ((8 - ((16 + fieldsLen) % 8)) % 8);
  if (buf.length < headerEnd + bodyLen) return null;
  const r = new Reader(buf, 12);
  const fields = {}; for (const [code, val] of r.read('a(yv)')) fields[code] = val;
  const msg = { type: buf[1], serial: buf.readUInt32LE(8), path: fields[F.PATH], iface: fields[F.INTERFACE], member: fields[F.MEMBER],
    errorName: fields[F.ERROR_NAME], replySerial: fields[F.REPLY_SERIAL], sender: fields[F.SENDER], sig: fields[F.SIGNATURE] || '', body: [] };
  const br = new Reader(buf.subarray(headerEnd, headerEnd + bodyLen));
  msg.body = splitSig(msg.sig).map(t => br.read(t));
  return { msg, size: headerEnd + bodyLen };
}

function busPath(addr = process.env.DBUS_SESSION_BUS_ADDRESS || '') {
  for (const part of addr.split(';')) {
    const [kind, rest = ''] = part.split(':');
    if (kind !== 'unix') continue;
    const kv = Object.fromEntries(rest.split(',').map(x => x.split('=').map(decodeURIComponent)));
    if (kv.path) return kv.path;
    if (kv.abstract) return '\0' + kv.abstract;
  }
  throw new Error('Kein D-Bus-Session-Bus gefunden');
}

class Bus {
  static connect(addr) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(busPath(addr));
      const bus = new Bus(sock);
      let auth = '';
      const fail = e => reject(e);
      sock.once('error', fail);
      sock.on('connect', () => { sock.write('\0AUTH EXTERNAL ' + Buffer.from(String(os.userInfo().uid)).toString('hex') + '\r\n'); });
      const onAuth = d => {
        auth += d.toString('latin1');
        if (!auth.includes('\r\n')) return;
        sock.off('data', onAuth);
        if (!auth.startsWith('OK')) return fail(new Error('D-Bus-Anmeldung abgelehnt'));
        sock.write('BEGIN\r\n');
        sock.off('error', fail);
        bus._start();
        bus.call({ dest: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', iface: 'org.freedesktop.DBus', member: 'Hello' })
          .then(([name]) => { bus.name = name; resolve(bus); }, fail);
      };
      sock.on('data', onAuth);
    });
  }
  constructor(sock) { this.sock = sock; this.serial = 0; this.pending = new Map(); this.handlers = new Set(); this.buf = Buffer.alloc(0); }
  _start() {
    this.sock.on('data', d => {
      this.buf = Buffer.concat([this.buf, d]);
      let m;
      while ((m = decodeMessage(this.buf))) {
        this.buf = this.buf.subarray(m.size);
        const msg = m.msg;
        if ((msg.type === T.RETURN || msg.type === T.ERROR) && this.pending.has(msg.replySerial)) {
          const { resolve, reject } = this.pending.get(msg.replySerial); this.pending.delete(msg.replySerial);
          msg.type === T.RETURN ? resolve(msg.body) : reject(Object.assign(new Error(msg.body[0] || msg.errorName), { name: msg.errorName }));
        } else if (msg.type === T.SIGNAL) for (const h of this.handlers) h(msg);
      }
    });
    const dead = e => { for (const { reject } of this.pending.values()) reject(e || new Error('D-Bus-Verbindung getrennt')); this.pending.clear(); };
    this.sock.on('error', dead); this.sock.on('close', () => dead());
  }
  /** Methode aufrufen → Rückgabewerte als Array */
  call({ dest, path, iface, member, sig = '', body = [] }) {
    const serial = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(serial, { resolve, reject });
      this.sock.write(encodeMessage({ type: T.CALL, serial, path, iface, member, dest, sig, body }));
    });
  }
  /** Signale empfangen (vorher passende Match-Regel setzen) → Funktion zum Abmelden */
  onSignal(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  addMatch(rule) { return this.call({ dest: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', iface: 'org.freedesktop.DBus', member: 'AddMatch', sig: 's', body: [rule] }); }
  close() { this.sock.end(); this.sock.destroy(); }
}

module.exports = { Bus, encodeMessage, decodeMessage, splitSig, busPath, T };
