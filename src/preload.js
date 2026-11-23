// Brücke zur Website: window.brtwrst gibt es nur auf unserer eigenen Domain.
// Die Hauptseite prüft die Herkunft jedes Aufrufs zusätzlich noch einmal selbst.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const own = ipcRenderer.sendSync('brtwrst:is-own', location.href);
if (own) {
  contextBridge.exposeInMainWorld('brtwrst', {
    version: ipcRenderer.sendSync('brtwrst:version'),
    platform: process.platform,
    /** Befehle per RCON ausführen → { ok, results: [{cmd, out}], error? } */
    rcon: (addr, pass, cmds) => ipcRenderer.invoke('brtwrst:rcon', { addr, pass, cmds }),
    /** Server im LAN abfragen + Mappool → { names: {id: name}, maps: [] } */
    scan: list => ipcRenderer.invoke('brtwrst:scan', { list }),
    /** Spielerliste per Server-Abfrage (A2S_PLAYER): Name, Score (meist Kills), Dauer → { ok, players } */
    players: addr => ipcRenderer.invoke('brtwrst:players', { addr }),
    /** GSI-Datei (Inhalt von der Website) in alle gefundenen CS2-cfg-Ordner legen → { ok, paths } */
    installGsi: (token, cfg) => ipcRenderer.invoke('brtwrst:gsi-install', { token, cfg }),
    /** Vorhandene GSI-Dateien auf diesen Inhalt bringen, keine neuen anlegen → { ok, updated: [Pfade], unchanged } */
    updateGsi: (token, cfg) => ipcRenderer.invoke('brtwrst:gsi-update', { token, cfg }),
    /** Unsere GSI-Datei aus allen CS2-cfg-Ordnern löschen → { ok, removed: [Pfade] } */
    removeGsi: () => ipcRenderer.invoke('brtwrst:gsi-remove'),
    /** GSI-Relay starten ({ on: true, token, port, addr? }) bzw. beenden ({ on: false }) → Status wie gsiRelayStatus */
    gsiRelay: opts => ipcRenderer.invoke('brtwrst:gsi-relay', opts),
    /** → { ok, on, addrs, uri?, port?, queue, received, rejected, forwarded, batches, lastOk, lastError, senders } */
    gsiRelayStatus: () => ipcRenderer.invoke('brtwrst:gsi-relay-status'),
  });
}
