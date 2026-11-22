# Offene Punkte – brtwrst-app

Stand: 2026-11-22 (0.2.2).

## Inkonsistenzen Website ↔ App
- **Installationen bis 0.1.7** bauen die GSI-cfg noch selbst (ohne `gsi_url` der Website); ab 0.1.8 kommt sie von
  der Website (`src/gsi.js`, `src/guard.js`). Auto-Update zieht sie nach.

## Einschränkungen
- Keine Code-Signatur (Windows), macOS nur ad-hoc signiert → Warnungen beim ersten Start.
- Kein Intel-Mac-Build; Mac-Nutzer mit Intel bekommen kein Update-Ziel (`mac-x64` fehlt im Manifest).
- GSI-Installation unter macOS bewusst abgelehnt; Flatpak darf nur in Steam-Ordner im Home schreiben
  (CS2 auf anderer Platte → Datei manuell von der Website).
- Bridge nur IPv4 und private Netze; `scan` höchstens 256 Server, `rcon` höchstens 200 Befehle.
- Verlust von `BRTWRST_SIGNING_KEY` erfordert manuelle Neuinstallation bei allen (`README.md`).

## Veraltete Unterpakete (npm warn deprecated, Stand 2026-11-22)
- `glob@7`/`inflight` (über `@electron/asar`), `rimraf@2` (über `electron-winstaller` → `temp`), `boolean`
  (über `@electron/get` → `global-agent`). Kommen aus `electron`/`electron-builder` in der neuesten Version; nur
  Build-Zeit, nicht in der App. Lösbar erst durch neue Versionen dort (bei jedem Release mit prüfen).
- `npm audit`: 6 × „moderate“, alle über `minimatch` 9/10 (ReDoS, GHSA-g3hv-75wg-m249, behoben erst in 11) in
  `app-builder-lib` und `@electron/universal`. Nur Build-Zeit mit eigenen Mustern; `npm audit fix` würde
  `electron-builder` auf 24 zurückstufen, daher nicht angewendet.
- Node-Deprecation-Warnungen aus GitHub-Actions selbst (neueste Versionen): `DEP0005 Buffer()` aus
  `actions/download-artifact@v8`, `DEP0040 punycode` im Flatpak-Job (Pages-Actions). Nicht unser Code.

## Offene Fragen
- **403 durch Rate-Limit des Hosters?** Während eines CS2-Matches (2026-11-21) wurde die eigene IP für
  brat.wurst.pw gesperrt (nginx: „access forbidden by rule“). Vermutete Ursache: GSI-POSTs der von
  `src/gsi.js` erzeugten cfg (`throttle 0.25`). Offen: Grenze beim Hoster erfragen; Details in
  `teambratwurst/docs/open-points.md`.
