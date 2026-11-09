# CLAUDE.md – brtwrst-app (Desktop-App)

**BRTWRST**: Electron-App für Windows, Linux und macOS (nur arm64). Sie ist ein Rahmen um die Website
https://brat.wurst.pw/lan/ und gibt deren Seiten über `window.brtwrst` Fähigkeiten, die ein Browser
nicht hat: RCON (TCP) und A2S-Scan (UDP) zu CS2-Servern im LAN, A2S-Spielerliste, GSI-Datei installieren.
Die App hat keine eigene Oberfläche, Login oder Daten – alles kommt von der Website.

**Zweites Repo:** `teambratwurst` (PHP-Website). Schnittstelle: `docs/integration.md`
(Kopie; Quelle der Wahrheit ist `teambratwurst/docs/integration.md`).

## Tech-Stack
- Electron 44, Node 22 (CI), CommonJS, keine Laufzeit-Abhängigkeiten (`dependencies` leer)
- electron-builder: AppImage, NSIS, dmg/zip (arm64); Flatpak per `flatpak-builder` aus dem Linux-Build
- Tests: `node:test` mit simuliertem CS2-Server (`test/fake-server.js`); `dbus-next` nur in Tests
- CI: GitHub Actions (`.github/workflows/release.yml`, `flatpak-check.yml`)

## Befehle
```sh
npm install
npm start                                     # lädt https://brat.wurst.pw/lan/
BRTWRST_URL=http://127.0.0.1:8099/ npm start  # gegen lokale Website (Origin gilt dann als eigene Seite)
npm test                                      # node --test "test/*.test.js"
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
| `src/gsi.js` | GSI-cfg bauen und in CS2-cfg-Ordner aller Steam-Bibliotheken schreiben |
| `src/updater.js`, `src/update-key.js` | Signierte Updates (Manifest + Ed25519), Tausch je Plattform |
| `src/flatpak.js`, `src/dbus.js` | Flatpak-Update über das Portal, eigener D-Bus-Client |
| `src/offline.html` | Fehlerseite, wenn die Website nicht lädt |
| `scripts/` | `manifest.js` (Release-Manifest signieren), `flatpak-build.sh` |
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
- `src/gsi.js` muss dieselbe cfg erzeugen wie `teambratwurst/app/pages/gsi.php` (doppelt gepflegt).
- `src/update-key.js` enthält den öffentlichen Schlüssel; ein neuer Schlüssel heißt: alle installieren einmal von Hand.
- AppImage startet mit `--no-sandbox` (`src/main.js`); Fenster bleiben über `contextIsolation`/`sandbox` isoliert.
- macOS-Builds sind nur ad-hoc signiert, nicht notarisiert; Windows unsigniert.
- `lan.brat.wurst.pw` in `src/guard.js` ist nur geplant (kein HTTPS).
- Festgelegte Mindestversion für die Website-Integration: 0.1.7 (nicht im Code erzwungen).

## Weitere Doku
- `docs/architecture.md` – Aufbau, Prozesse, Update-/Release-Ablauf
- `docs/integration.md` – Schnittstelle zur Website (Kopie)
- `docs/open-points.md` – Einschränkungen, Inkonsistenzen, offene Fragen
- `README.md` – Nutzer-/Release-Doku (Sicherheit, Updates je Plattform, Flatpak)
