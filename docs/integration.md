# Integration Website ↔ BRTWRST-App

> Kopie, Quelle: teambratwurst (`docs/integration.md`), Stand: teambratwurst `e3ef886` / brtwrst-app `d167099`, 2026-11-09.
> Änderungen zuerst in teambratwurst vornehmen und hierher kopieren.

**Quelle der Wahrheit:** diese Datei (`teambratwurst/docs/integration.md`).
Eine Kopie liegt in `brtwrst-app/docs/integration.md`; Änderungen hier vornehmen und dorthin übertragen.

## Grundprinzip
Die App (Electron) lädt die Website `https://brat.wurst.pw/lan/` in ihr Fenster (`brtwrst-app/src/guard.js`,
`START_URL`). Inhalte, Login und Daten kommen ausschließlich von der Website. Die App fügt nur Fähigkeiten
hinzu, die ein Browser nicht hat, über das Objekt `window.brtwrst` (`brtwrst-app/src/preload.js`).
Es gibt **keine** HTTP-API der Website speziell für die App; die App spricht nur mit
CS2-Servern im LAN, GitHub (Updates) und dem lokalen Dateisystem (GSI-Datei).

## Wer bekommt `window.brtwrst`?
- Nur Seiten, deren URL `isOwn()` erfüllt (`brtwrst-app/src/guard.js`):
  - `https://brat.wurst.pw/lan/…` (produktiv)
  - `https://lan.brat.wurst.pw/…` (in Planung, Umsetzung ungewiss; Domain hat derzeit kein HTTPS)
  - mit `BRTWRST_URL` gesetzt zusätzlich deren Origin (lokales Testen)
- Der Hauptprozess prüft bei jedem Aufruf erneut die Herkunft (`fromOwn`, `brtwrst-app/src/main.js`).
- Fremde Links öffnen im System-Browser; Berechtigungen nur `clipboard-sanitized-write` für eigene Seiten.

## API `window.brtwrst`
| Member | Signatur → Antwort | Nutzung in der Website |
|---|---|---|
| `version` | String, z. B. `"0.1.7"` | `assets/rcon-exec.js` (Anzeige) |
| `platform` | `process.platform` (`win32`, `darwin`, `linux`) | `app/pages/gsi.php` (macOS-Hinweis) |
| `rcon(addr, pass, cmds)` | → `{ ok, results: [{cmd, out}], error? }`; bei Abbruch ist `results` ggf. teilweise gefüllt | `assets/rcon-exec.js` (Befehle, Config-Prüfung, `status`, `listid`, Kick/Unban) |
| `scan(list)` | `list = [[id, "ip:port"], …]` → `{ names: {id: name}, maps: [...], error? }` | `assets/rcon-exec.js` („Server laden“) |
| `players(addr)` | → `{ ok, players: [{name, score, time}], error? }` (A2S_PLAYER, `score` meist Kills) | `assets/rcon-exec.js` (`sendSrv`: Kills gehen per `rcon_srv` an die Gegnerkacheln im Beamer) |
| `installGsi(token)` | → `{ ok, paths: [...] }` bzw. `{ ok: false, error }` | `app/pages/gsi.php` |

### Validierung in der App (`brtwrst-app/src/guard.js`, `src/main.js`)
- `addr`: `IPv4:Port`, nur 10/8, 172.16/12, 192.168/16, 127/8.
- `pass`: String, 1–64 Zeichen.
- `cmds`: Array mit 1–200 Strings, je 1–512 Zeichen, ohne `\r`, `\n`, `\0`.
- `scan`: höchstens 256 Einträge; `id` 1–4 Ziffern; ungültige Einträge werden still verworfen.
- `installGsi`: `token` muss `^[A-Za-z0-9._~-]{8,200}$` erfüllen.
- Fehler kommen als Objekt mit `ok: false` / `error` (deutsch), nicht als Exception.

## RCON-Konventionen (beide Seiten)
- Server-Adressen legt die Website fest (`app/pages/rcon.php`: 10.10.100.11–30, Ports 27015/27016).
- RCON-Passwort = Hausnummer (2–3 Ziffern) am Ende des Servernamens (`app/pages/rcon.php`,
  `brtwrst-app/src/scan.js`). Der Scan nutzt das, um den Mappool per `maps *` zu holen (max. 3 Versuche).
- Adresse/Passwort-Auswahl bleibt im Browser (`localStorage`). Per POST an `?p=rcon` (mit CSRF) gehen:
  `rcon_names` (Servernamen/Mappool → `kv`), `rcon_kick` (Kick-/Unban-Protokoll → `kv` `rcon_kicks_<mta>`),
  `rcon_srv` (Spielerliste des gewählten Servers alle 5 s → `storage/live.json`, für den Beamer).

## GSI (Game State Integration)
- Empfänger: `gsi.php`. Liest den Request-Body als JSON (höchstens 200 000 Bytes, Rest wird abgeschnitten; die
  HTTP-Methode wird nicht geprüft). Config-Pfad alternativ über `TBW_CONFIG`. Auth: `auth.token` muss `gsi_token` aus `config.php`
  entsprechen, sonst HTTP 403. Ohne Session und ohne DB; schreibt `storage/live.json`.
- Die cfg-Datei `gamestate_integration_brtwrst.cfg` entsteht an zwei Stellen mit gleichem Inhalt:
  - Download: `app/pages/gsi.php` (`$gsiCfg`), URI = `gsi_url` aus der Config **oder** aus Host + Pfad abgeleitet.
  - App: `brtwrst-app/src/gsi.js` (`buildCfg`), URI = `gsi.php` relativ zur aufrufenden Seite (`src/main.js`);
    `gsi_url` kennt die App nicht.
  - Gemeinsame Felder: Name `"BRTWRST Beamer"`, `timeout 5.0`, `buffer 0.1`, `throttle 0.25`, `heartbeat 10.0`,
    `data`: `provider, map, round, player_id, player_state, player_weapons, player_match_stats, player_position, phase_countdowns`.
- Die App sucht Steam-Bibliotheken (Registry bzw. bekannte Linux-Pfade + `libraryfolders.vdf`) und schreibt in
  jeden gefundenen `…/Counter-Strike Global Offensive/game/csgo/cfg/`. Unter macOS lehnt sie ab.

## Versionen und Kompatibilität
- Die Website erkennt die App nur über die Existenz von `window.brtwrst` und prüft einzelne Funktionen
  per Feature-Detection (`window.brtwrst.players`, `window.brtwrst?.installGsi`). Eine Versionsprüfung gibt es nicht.
- Festgelegte Mindestversion (Entscheidung Betreiber, 2026-11): **0.1.7** (aktueller Stand; Auto-Update geht ab 0.1.5).
  Bei gravierenden Schnittstellenänderungen wird sie angehoben. Im Code ist das derzeit nicht erzwungen.
- Neue Bridge-Funktionen: zuerst in der App veröffentlichen, auf der Website nur mit Feature-Detection nutzen
  und einen Hinweis „bitte aktualisieren“ zeigen (Muster: `app/pages/gsi.php`).
- Download-Links der Website zeigen auf `github.com/bauerrrrrrr/brtwrst-app/releases/latest` und
  `bauerrrrrrr.github.io/brtwrst-app/` (Flatpak) (`app/pages/rcon.php`).
