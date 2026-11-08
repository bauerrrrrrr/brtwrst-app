# BRTWRST

Das Team-Bratwurst-Intranet als App für **Windows und Linux**, mit direktem **RCON** und **LAN-Scan** für die CS2-Server auf der MTA-LAN.

Die App ist ein Rahmen um die Website <https://lan.brat.wurst.pw/>. Inhalte, Login und Daten kommen live von dort. Zusätzlich kann die App, was ein Browser nicht darf:

- **RCON:** Befehle per TCP an die CS2-Server schicken, die Antworten erscheinen auf der Seite. Dafür braucht es weder rcon-cli noch PowerShell oder eine Einrichtung.
- **LAN-Scan:** alle Server per A2S (UDP) abfragen, dazu den Mappool per RCON von einem Server.

## Sicherheit

- **Nur eigene Seiten:** Die Schnittstelle `window.brtwrst` gibt es nur auf `https://lan.brat.wurst.pw/` und `https://brat.wurst.pw/lan/`. Der Hauptprozess prüft die Herkunft jedes Aufrufs zusätzlich selbst.
- **Nur LAN:** RCON und Scan gehen nur an private Adressen (10/8, 172.16/12, 192.168/16, 127/8) im Format `IP:Port`.
- **Saubere Befehle:** Sie werden als Text übergeben, ohne Zeilenumbrüche, höchstens 200 pro Aufruf.
- **Fremde Links:** Sie öffnen sich im System-Browser, nicht im App-Fenster.
- **Berechtigungen:** Kamera, Mikrofon und Co. bekommt keine Seite. Unsere Seiten dürfen nur in die Zwischenablage schreiben.
- **Isolation:** Das Fenster läuft isoliert (`contextIsolation`, `sandbox`, kein `nodeIntegration`).

## Schnittstelle für die Website

```js
if (window.brtwrst) {
  const r = await brtwrst.rcon('10.10.100.17:27016', '147', ['game_mode', 'mp_maxrounds']);
  // { ok: true, results: [{ cmd: 'game_mode', out: 'game_mode = 1' }, …] }  bzw. { ok: false, error: 'Passwort falsch' }
  const s = await brtwrst.scan([['23', '10.10.100.17:27016'], …]);
  // { names: { 23: '23 MTA Haus 147' }, maps: ['ar_baggage', …] }
}
```

`brtwrst.version` und `brtwrst.platform` verraten Version und System.

## Entwickeln

```sh
npm install
npm start                                   # lädt https://lan.brat.wurst.pw/
BRTWRST_URL=http://127.0.0.1:8099/ npm start  # gegen eine lokale Testversion der Website
npm test                                    # RCON, Scan und Absicherung gegen einen simulierten Server
npm run dist:linux                          # AppImage + .deb in dist/
npm run dist:win                            # Windows-Installer in dist/
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/main.js` | Fenster, Navigation, Berechtigungen, Schnittstelle |
| `src/preload.js` | `window.brtwrst`, nur für eigene Seiten |
| `src/guard.js` | eigene Domain, LAN-Adressen, Befehlsprüfung |
| `src/rcon.js` | Source-RCON-Client, eine Verbindung pro Auftrag, lange Antworten über mehrere Pakete |
| `src/scan.js` | A2S-Scan und Mappool |
| `test/` | Tests mit simuliertem CS2-Server |
