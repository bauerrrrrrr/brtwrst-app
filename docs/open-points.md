# Offene Punkte – brtwrst-app

Nur dokumentiert, nichts behoben. Stand: Commit `d167099` (0.1.7, 2026-11-09).

## Inkonsistenzen Website ↔ App
- **GSI-cfg doppelt gepflegt:** `src/gsi.js` (`buildCfg`) und `teambratwurst/app/pages/gsi.php` – derzeit
  identisch, ohne gemeinsame Quelle oder Vergleichstest.
- **`gsi_url` der Website wird ignoriert:** Die App setzt als URI `gsi.php` relativ zur aufrufenden Seite
  (`src/main.js`, `brtwrst:gsi-install`). Setzt die Website `gsi_url`, zeigen App- und Download-Datei auf
  unterschiedliche Adressen.
- **Mindestversion 0.1.7** ist vereinbart, aber weder hier noch auf der Website geprüft (nur Feature-Detection).
- **`lan.brat.wurst.pw`** ist in `ALLOWED` (`src/guard.js`), aber nur geplant und ohne HTTPS.

## Einschränkungen
- Keine Code-Signatur (Windows), macOS nur ad-hoc signiert → Warnungen beim ersten Start.
- Kein Intel-Mac-Build; Mac-Nutzer mit Intel bekommen kein Update-Ziel (`mac-x64` fehlt im Manifest).
- GSI-Installation unter macOS bewusst abgelehnt; Flatpak darf nur in Steam-Ordner im Home schreiben
  (CS2 auf anderer Platte → Datei manuell von der Website).
- Bridge nur IPv4 und private Netze; `scan` höchstens 256 Server, `rcon` höchstens 200 Befehle.
- Verlust von `BRTWRST_SIGNING_KEY` erfordert manuelle Neuinstallation bei allen (`README.md`).

## Kleinere Auffälligkeiten
- Unterschiedliche IDs: electron-builder `appId` `pw.wurst.brat.brtwrst`, Flatpak `pw.wurst.brat.Brtwrst`,
  `desktopName` `brtwrst.desktop` (`package.json`, `flatpak/`). Ob gewollt, ist unklar.
- `scripts/flatpak-build.sh` schreibt Version/Datum per `sed` direkt in `flatpak/pw.wurst.brat.Brtwrst.metainfo.xml`
  (lokal ausgeführt verändert es eine versionierte Datei).
