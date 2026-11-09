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
    /** GSI-Datei in alle gefundenen CS2-cfg-Ordner legen → { ok, paths } */
    installGsi: token => ipcRenderer.invoke('brtwrst:gsi-install', { token }),
  });
}
