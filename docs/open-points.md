# Offene Punkte – brtwrst-app

Stand: 2026-11-22 (Code nach 0.1.7, noch nicht veröffentlicht).

## Inkonsistenzen Website ↔ App
- **Bis zum nächsten Release:** Die veröffentlichte 0.1.7 baut die GSI-cfg noch selbst (ohne `gsi_url` der Website)
  und hat `https://lan.brat.wurst.pw` in `ALLOWED`. Im Code (`src/gsi.js`, `src/guard.js`) ist beides behoben.

## Einschränkungen
- Keine Code-Signatur (Windows), macOS nur ad-hoc signiert → Warnungen beim ersten Start.
- Kein Intel-Mac-Build; Mac-Nutzer mit Intel bekommen kein Update-Ziel (`mac-x64` fehlt im Manifest).
- GSI-Installation unter macOS bewusst abgelehnt; Flatpak darf nur in Steam-Ordner im Home schreiben
  (CS2 auf anderer Platte → Datei manuell von der Website).
- Bridge nur IPv4 und private Netze; `scan` höchstens 256 Server, `rcon` höchstens 200 Befehle.
- Verlust von `BRTWRST_SIGNING_KEY` erfordert manuelle Neuinstallation bei allen (`README.md`).

## Offene Fragen
- **403 durch Rate-Limit des Hosters?** Während eines CS2-Matches (2026-11-21) wurde die eigene IP für
  brat.wurst.pw gesperrt (nginx: „access forbidden by rule“). Vermutete Ursache: GSI-POSTs der von
  `src/gsi.js` erzeugten cfg (`throttle 0.25`). Offen: Grenze beim Hoster erfragen; Details in
  `teambratwurst/docs/open-points.md`.
