# CLAUDE.md – brtwrst-app (Desktop-App)

**BRTWRST**: Electron-App für Windows, Linux und macOS (nur arm64). Sie ist ein Rahmen um die Website
https://brat.wurst.pw/lan/ und gibt deren Seiten über `window.brtwrst` Fähigkeiten, die ein Browser
nicht hat: RCON (TCP) und A2S-Scan (UDP) zu CS2-Servern im LAN, A2S-Spielerliste, GSI-Datei installieren.
Die App hat keine eigene Oberfläche, Login oder Daten – alles kommt von der Website.

**Zweites Repo:** `teambratwurst` (PHP-Website). Schnittstelle: `docs/integration.md`
(Kopie; Quelle der Wahrheit ist `teambratwurst/docs/integration.md`).

## Tech-Stack
- Electron 45, Node 26 (CI), CommonJS, keine Laufzeit-Abhängigkeiten (`dependencies` leer)
- electron-builder: AppImage, NSIS, dmg/zip (arm64); Flatpak per `flatpak-builder` aus dem Linux-Build
- Tests: `node:test` mit simuliertem CS2-Server (`test/fake-server.js`) und nachgebautem Flatpak-Portal über den
  eigenen D-Bus-Client (`test/flatpak.test.js`, braucht `dbus-daemon`); keine Test-Abhängigkeiten außer Electron-Werkzeugen
- CI: GitHub Actions (`.github/workflows/release.yml`, `flatpak-check.yml`)

## Befehle
```sh
npm install
npm start                                     # lädt https://brat.wurst.pw/lan/
BRTWRST_URL=http://127.0.0.1:8099/ npm start  # gegen lokale Website (Origin gilt dann als eigene Seite)
npm test                                      # node --test "test/*.test.js"
npm run versions                              # Komponenten gegen neueste stabile Version (scripts/versions.js)
npm run dist:linux | dist:win | dist:mac      # Pakete nach dist/
```
- Release: `npm version X.Y.Z --no-git-tag-version`, committen mit Betreff `BRTWRST X.Y.Z: <was neu ist>`,
  auf `main` pushen. Der Workflow baut, wenn es den Tag `vX.Y.Z` noch nicht gibt; der Commit-Betreff
  wird zum Update-Text in der App.
- Umgebungsvariablen: `BRTWRST_URL` (Startseite), `BRTWRST_UPDATE_URL` (Update-Quelle, aktiviert Update-Prüfung
  auch unpaketiert), `BRTWRST_UPDATE_YES` (Dialoge automatisch bestätigen, für Tests).
- CI-Secrets (nur Namen): `BRTWRST_SIGNING_KEY` (Ed25519, PEM/PKCS#8), `BRTWRST_FLATPAK_GPG_KEY`.

## Struktur
| Pfad | Inhalt |
|---|---|
| `src/main.js` | Fenster, Navigation, Berechtigungen, IPC-Handler der Bridge, Update-Ablauf, Menü |
| `src/preload.js` | `window.brtwrst` (nur auf eigenen Seiten) |
| `src/guard.js` | `START_URL`, erlaubte Origins (`isOwn`), LAN-Adressen, Befehlsprüfung |
| `src/rcon.js` / `src/scan.js` | Source-RCON-Client / A2S_INFO-Scan, Mappool, A2S_PLAYER |
| `src/gsi.js` | GSI-cfg (Inhalt von der Website) in CS2-cfg-Ordner aller Steam-Bibliotheken schreiben |
| `src/updater.js`, `src/update-key.js` | Signierte Updates (Manifest + Ed25519), Tausch je Plattform |
| `src/flatpak.js`, `src/dbus.js` | Flatpak-Update über das Portal, eigener D-Bus-Client |
| `src/offline.html` | Fehlerseite, wenn die Website nicht lädt |
| `scripts/` | `manifest.js` (Release-Manifest signieren), `flatpak-build.sh`, `versions.js` (Versionsprüfung) |
| `flatpak/`, `build/` | Flatpak-Manifest/Starter/Metainfo/GPG-Pubkey; Icons |
| `test/` | Tests (RCON, Scan, GSI, Updater, Flatpak, macOS-Tausch) |

## Konventionen
- Kommentare, Fehlermeldungen und Dialoge auf Deutsch.
- Jeder neue IPC-Handler prüft zuerst `fromOwn(e)` und validiert alle Argumente in `src/guard.js`-Manier;
  Fehler als `{ ok: false, error }` zurückgeben, nicht werfen.
- Netzwerkziele der Bridge nur private IPv4-Adressen (`isLanAddr`).
- Neue Bridge-Funktion = Schnittstellenänderung → `docs/integration.md` hier **und** in teambratwurst anpassen;
  die Website nutzt sie nur per Feature-Detection.

## Stolperfallen
- Die GSI-cfg baut nur die Website (`teambratwurst/app/pages/gsi.php`); `validGsiCfg` in `src/guard.js` muss deren
  Format zulassen (Kopf, VDF-Zeilen, Ziel nur eigene Seite oder LAN-IPv4).
- `src/update-key.js` enthält den öffentlichen Schlüssel; ein neuer Schlüssel heißt: alle installieren einmal von Hand.
- AppImage startet mit `--no-sandbox` (`src/main.js`); Fenster bleiben über `contextIsolation`/`sandbox` isoliert.
- macOS-Builds sind nur ad-hoc signiert, nicht notarisiert; Windows unsigniert.
- `lan.brat.wurst.pw` ist bewusst nicht in `ALLOWED` (`src/guard.js`), solange die Subdomain kein HTTPS hat.
- Install-Skripte von Abhängigkeiten regelt `allowScripts` in `package.json` (npm ≥ 11.20; `npm approve-scripts` /
  `npm deny-scripts`). `electron-winstaller` ist gesperrt: nur für das Squirrel-Ziel nötig, gebaut wird NSIS.
- Festgelegte Mindestversion für die Website-Integration: 0.1.7 (die Website zeigt älteren Apps nur einen Hinweis, `teambratwurst/assets/app.js`).

## Release (nur auf ausdrückliche Anweisung, z. B. „Release 0.1.8“)
Ein Push auf `main` mit neuer Version erreicht über Auto-Updates alle Nutzer. Ohne Anweisung die Version nicht erhöhen.
1. **Letzten Release-Lauf auswerten:** Annotations (Warnungen, Notices, Fehler) des letzten Laufs von `release.yml`
   und `flatpak-check.yml` lesen und die Job-Logs aller Jobs nach `warn`/`deprecated`/`Deprecation`/`vulnerabilit`
   durchsuchen (GitHub-Tools, `actions_list`/`get_job_logs`); dazu `npm audit`. Ursachen beheben oder im Bericht begründen, warum nicht (z. B. reine Info von
   GitHub, Altlast in einem Fremdpaket, das schon aktuell ist; siehe `docs/open-points.md`).
2. **Auf neueste stabile Versionen gehen**, nicht auf die Mindestversion, die eine Warnung beseitigt.
   `npm run versions` listet alles, was in `package.json`, in den `uses:`/`node-version`-Zeilen der Workflows und
   in `flatpak/*.yml` steht, **und die Website** (`../teambratwurst`: Leaflet, PHP auf dem Server; dort Abschnitt
   „Komponenten aktuell halten“). Jede Zeile `NEUER` anheben (Breaking Changes in Release-Notes/README prüfen) oder
   im Bericht begründen. Kommt eine neue Art Komponente dazu (z. B. andere Paketquelle), `scripts/versions.js` erweitern.
3. `npm test` grün (der Hook `.claude/settings.json` prüft zusätzlich jede geänderte `.js`-Datei mit `node --check`).
4. Schnittstelle geändert? `docs/integration.md` hier und in teambratwurst aktuell, ggf. Mindestversion eintragen.
5. `npm version X.Y.Z --no-git-tag-version`; Commit-Betreff `BRTWRST X.Y.Z: <was neu ist>` (wird zum Update-Text).
6. Push auf `main`; im Abschlussbericht Version, Betreff, ausgewertete Annotations, Versionssprünge und
   aktualisierte Doku-Dateien nennen.

## Doku-Pflege
- Nur tatsächlich betroffene Doku-Stellen aktualisieren; keine unnötigen Umschreibungen oder Wiederholungen.
- Nur den Ist-Zustand dokumentieren (mit Dateipfad als Beleg), nichts vermuten oder erfinden;
  Unklares als offene Frage in `docs/open-points.md`.
- Änderungen an `window.brtwrst` (`src/preload.js`, IPC in `src/main.js`, `src/guard.js`) oder `src/gsi.js`:
  zuerst `teambratwurst/docs/integration.md` anpassen, dann hierher kopieren (Stand im Kopf aktualisieren).
- Neue Umgebungsvariablen oder CI-Secrets: im selben Commit oben unter „Befehle“ eintragen (nur Namen, nie Werte).
- Nicht sofort behobene Inkonsistenzen/Schulden als Stichpunkt in `docs/open-points.md`; behobene Punkte dort entfernen.
- Mindestversion für die Website anheben → in `teambratwurst/docs/integration.md` (und Kopie) mit Datum und Grund eintragen.
- Im Abschlussbericht kurz aufführen, welche Doku-Dateien aktualisiert wurden.

## Weitere Doku
- `docs/architecture.md` – Aufbau, Prozesse, Update-/Release-Ablauf
- `docs/integration.md` – Schnittstelle zur Website (Kopie)
- `docs/open-points.md` – Einschränkungen, Inkonsistenzen, offene Fragen
- `README.md` – Nutzer-/Release-Doku (Sicherheit, Updates je Plattform, Flatpak)
