# Integration Website ↔ BRTWRST-App

> Kopie, Quelle: teambratwurst (`docs/integration.md`), Stand: 2026-11-23, App 0.2.2 + GSI-Relay (noch nicht veröffentlicht).
> Änderungen zuerst in teambratwurst vornehmen und hierher kopieren.

**Quelle der Wahrheit:** diese Datei (`teambratwurst/docs/integration.md`).
Eine Kopie liegt in `brtwrst-app/docs/integration.md`; Änderungen hier vornehmen und dorthin übertragen.

## Grundprinzip
Die App (Electron) lädt die Website `https://brat.wurst.pw/lan/` in ihr Fenster (`brtwrst-app/src/guard.js`,
`START_URL`). Inhalte, Login und Daten kommen ausschließlich von der Website. Die App fügt nur Fähigkeiten
hinzu, die ein Browser nicht hat, über das Objekt `window.brtwrst` (`brtwrst-app/src/preload.js`).
Es gibt **keine** HTTP-API der Website speziell für die App; die App spricht nur mit
CS2-Servern im LAN, GitHub (Updates), dem lokalen Dateisystem (GSI-Datei) und – als GSI-Relay – mit `gsi.php`
(dasselbe Format wie CS2, nur gebündelt, siehe „GSI-Relay“).

## Wer bekommt `window.brtwrst`?
- Nur Seiten, deren URL `isOwn()` erfüllt (`brtwrst-app/src/guard.js`):
  - `https://brat.wurst.pw/lan/…` (produktiv; `https://lan.brat.wurst.pw/` bewusst nicht, solange die Subdomain kein HTTPS hat)
  - mit `BRTWRST_URL` gesetzt zusätzlich deren Origin (lokales Testen)
- Der Hauptprozess prüft bei jedem Aufruf erneut die Herkunft (`fromOwn`, `brtwrst-app/src/main.js`).
- Fremde Links öffnen im System-Browser; Berechtigungen nur `clipboard-sanitized-write` für eigene Seiten.
- Nur 0.2.1 zeigte die Steam-Anmeldung im Hauptfenster (`isSteamLogin()`); ab 0.2.2 wieder entfernt.

## Login in der App (Steam im System-Browser)
Keine Bridge-Funktion; die Website nutzt nur, dass die App fremde Adressen aus `window.open` im System-Browser
öffnet (`setWindowOpenHandler` in `brtwrst-app/src/main.js`, alle Versionen). Ablauf (`app/pages/login.php`, `app/auth.php`):
1. Login-Seite erkennt die App (`window.brtwrst`), Klick → POST `action=pair_start` (CSRF) legt `login_pairs` an
   (5 min, Kennung in der App-Session) und liefert die Steam-Adresse; `return_to` enthält `pair` und den `state` des Vorgangs.
2. `window.open(url)` → Browser: Steam-Anmeldung, Rückkehr `?p=login&steam=back&pair=…`, Prüfung wie im Browser-Login,
   dann Frage „App-Anmeldung als … freigeben?“ (Warnung, wenn der Vorgang aus einer anderen IP gestartet wurde).
3. Die App fragt alle 2 s `?p=login&pair_poll=1` (JSON `state`: `warten|ok|abgebrochen|abgelaufen`); bei `ok` ist die
   App-Session angemeldet. Der Browser selbst bleibt dabei abgemeldet.

## API `window.brtwrst`
| Member | Signatur → Antwort | Nutzung in der Website |
|---|---|---|
| `version` | String, z. B. `"0.2.0"` | `assets/app.js` (Link „BRTWRST-App x.y.z“ unten in der Seitenleiste öffnet „Was ist neu“ und markiert mit `?seit=` Neueres; Hinweis bei zu alter App), `assets/rcon-exec.js` (Anzeige) |
| `platform` | `process.platform` (`win32`, `darwin`, `linux`) | `app/pages/gsi.php` (macOS-Hinweis) |
| `steamLogin` | `true` nur in 0.2.1 (ab 0.2.2 entfernt) | nicht mehr genutzt |
| `rcon(addr, pass, cmds)` | → `{ ok, results: [{cmd, out}], error? }`; bei Abbruch ist `results` ggf. teilweise gefüllt | `assets/rcon-exec.js` (Befehle, Config-Prüfung, `status`, `listid`, Kick/Unban) |
| `scan(list)` | `list = [[id, "ip:port"], …]` → `{ names: {id: name}, maps: [...], error? }` | `assets/rcon-exec.js` („Server laden“) |
| `players(addr)` | → `{ ok, players: [{name, score, time}], error? }` (A2S_PLAYER, `score` meist Kills) | `assets/rcon-exec.js` (`sendSrv`: Kills gehen per `rcon_srv` an die Gegnerkacheln im Beamer) |
| `installGsi(token, cfg)` | → `{ ok, paths: [...] }` bzw. `{ ok: false, error }`; `cfg` = Dateiinhalt von der Website | `app/pages/gsi.php` |
| `updateGsi(token, cfg)` | → `{ ok, updated: [Pfade], unchanged }` bzw. `{ ok: false, error }`; schreibt nur dort, wo `gamestate_integration_brtwrst.cfg` schon liegt und sich der Inhalt unterscheidet; unter macOS nichts | `assets/app.js` (höchstens alle 5 min, Inhalt von `?p=gsi&appcfg=1`) |
| `removeGsi()` | → `{ ok, removed: [Pfade] }` bzw. `{ ok: false, error, removed }`; löscht nur `gamestate_integration_brtwrst.cfg` in allen CS2-cfg-Ordnern; unter macOS nichts | `assets/app.js` (wenn kein Relay aktiv ist) |
| `gsiRelay({ on, token, port, addr? })` | GSI-Relay starten (`on: true`) bzw. beenden (`on: false`) → Status wie `gsiRelayStatus` oder `{ ok: false, error }` | `app/pages/gsi.php` (nur Admins) |
| `gsiRelayStatus()` | → `{ ok, on, addrs: ["192.168.…"], uri?, port?, queue, received, rejected, forwarded, batches, lastOk, lastError, senders: {steamid: {name, ts}} }` (Zeiten in ms) | `app/pages/gsi.php` |

### Validierung in der App (`brtwrst-app/src/guard.js`, `src/main.js`)
- `addr`: `IPv4:Port`, nur 10/8, 172.16/12, 192.168/16, 127/8.
- `pass`: String, 1–64 Zeichen.
- `cmds`: Array mit 1–200 Strings, je 1–512 Zeichen, ohne `\r`, `\n`, `\0`.
- `scan`: höchstens 256 Einträge; `id` 1–4 Ziffern; ungültige Einträge werden still verworfen.
- `installGsi`: `token` muss `^[A-Za-z0-9._~-]{8,200}$` erfüllen. `cfg` (`validGsiCfg`): höchstens 4096 Zeichen,
  ohne `\r`/`\0`, erste Zeile `"BRTWRST Beamer"`, nur VDF-Zeilen (`"Schlüssel"`, `"Schlüssel" "Wert"`, `{`, `}`),
  genau ein `uri` mit `http(s)` zu einer eigenen Seite (`isOwn`) oder zu einer LAN-IPv4 wie oben, enthält
  `"token" "<token>"`. Fehlt `cfg`: Fehler „Die Seite ist veraltet …“.
- `updateGsi`: `token` und `cfg` wie bei `installGsi`.
- `gsiRelay`: `token` wie bei `installGsi`; `port` ganzzahlig 1024–65535; `addr` (optional) muss eine eigene
  LAN-IPv4 des PCs sein (`lanAddrs()` in `brtwrst-app/src/relay.js`), sonst die erste. Jeder Aufruf beendet
  einen laufenden Relay zuerst. Belegter Port → `error` „Port … ist schon belegt“.
- Fehler kommen als Objekt mit `ok: false` / `error` (deutsch), nicht als Exception.

## RCON-Konventionen (beide Seiten)
- Server-Adressen legt die Website fest (`app/pages/rcon.php`: 10.10.100.11–30, Ports 27015/27016).
- RCON-Passwort = Hausnummer (2–3 Ziffern) am Ende des Servernamens (`app/pages/rcon.php`,
  `brtwrst-app/src/scan.js`). Der Scan nutzt das, um den Mappool per `maps *` zu holen (max. 3 Versuche).
- Adresse/Passwort-Auswahl bleibt im Browser (`localStorage`). Per POST an `?p=rcon` (mit CSRF) gehen:
  `rcon_names` (Servernamen/Mappool → `kv`), `rcon_kick` (Kick-/Unban-Protokoll → `kv` `rcon_kicks_<mta>`),
  `rcon_srv` (Spielerliste des gewählten Servers alle 5 s → `storage/live.json`, für den Beamer).

## GSI (Game State Integration)
- Empfänger: `gsi.php`. Liest den Request-Body als JSON (höchstens 4 000 000 Bytes, Rest wird abgeschnitten; die
  HTTP-Methode wird nicht geprüft). Config-Pfad alternativ über `TBW_CONFIG`. Auth: `auth.token` muss `gsi_token` aus `config.php`
  entsprechen, sonst HTTP 403. Ohne Session und ohne DB; schreibt `storage/live.json` (`live_ingest()` in `app/live.php`).
- Die cfg-Datei `gamestate_integration_brtwrst.cfg` baut nur die Website: `app/pages/gsi.php` (`$gsiCfg`),
  URI = eingetragener GSI-Relay (siehe unten). **Ohne aktiven Relay ist GSI aus:** keine Datei, kein Download
  (`?p=gsi&dl=1` zeigt nur die Seite), kein Installieren; die App entfernt vorhandene Dateien (`removeGsi`).
  Grund: Direkte Meldungen vieler Spieler lösen die Firewall des Hosters aus. Die Datei gibt es als Download und
  geht als `cfg` an `installGsi`; die App schreibt sie unverändert (`brtwrst-app/src/gsi.js`).
  `gsi.php` nimmt einzelne Meldungen weiterhin an (alte Dateien), die Website verteilt aber keine solche Datei mehr.
  - Felder: Name `"BRTWRST Beamer"`, `timeout 5.0`, `buffer 0.1`, `throttle 0.25`, `heartbeat 10.0`,
    `data`: `provider, map, round, player_id, player_state, player_weapons, player_match_stats, player_position, phase_countdowns`.
- Die App sucht Steam-Bibliotheken (Registry bzw. bekannte Linux-Pfade + `libraryfolders.vdf`) und schreibt in
  jeden gefundenen `…/Counter-Strike Global Offensive/game/csgo/cfg/`. Unter macOS lehnt sie ab.

### GSI-Relay (App ab der ersten Version mit `gsiRelay`)
Grund: Die Firewall des Hosters sperrt die gemeinsame LAN-IP, wenn viele Geräte gleichzeitig an `gsi.php` senden
(`docs/open-points.md`). Der Relay bündelt das auf etwa eine Anfrage pro Sekunde.
- App (`brtwrst-app/src/relay.js`): HTTP-Empfänger auf `0.0.0.0:<port>`, nimmt POSTs (JSON, höchstens 200 000 Bytes,
  `auth.token` = Token aus `gsiRelay`, sonst 403) an jedem Pfad an. Etwa jede Sekunde, wenn etwas vorliegt, ein POST an
  `gsi.php` der Website (`START_URL` + `gsi.php`):
  `{ "auth": {"token": …}, "relay": "http://<LAN-IP>:<port>/", "batch": [{ "age_ms": …, "m": <CS2-Meldung ohne auth> }, …] }`
  (höchstens 400 Meldungen, Reihenfolge wie empfangen). Ohne Meldungen alle 30 s ein leeres Bündel (Lebenszeichen),
  ebenso direkt beim Start. Bei Fehlern Backoff 2–30 s; staut es sich, bleibt je Spieler nur die jüngste Meldung.
- `gsi.php`/`live_ingest()`: wendet jede Meldung mit ihrem Empfangszeitpunkt (`jetzt − age_ms`) über `live_apply()`
  an; Sender bekommen `via: relay` (sonst `direkt`). Passt `relay` zur eingetragenen Adresse, wird `relay.seen` aktualisiert.
- Eintragen nur durch Admins: `app/pages/gsi.php` startet den Relay per `gsiRelay` und schickt dann POST
  `action=relay_on` (CSRF, `is_admin()`) mit `uri`; `relay_off` trägt aus. Erlaubt ist nur `http://<private IPv4>:<1024–65535>/`
  (`live_relay_uri()`). Gespeichert in `storage/live.json` (`relay: {uri, at, seen}`). Solange die letzte Meldung
  bzw. das Eintragen höchstens 24 h her ist (`LIVE_RELAY_TTL`), zeigt die cfg auf den Relay (danach ist GSI aus); die App installiert sie
  unverändert (`isGsiTarget` erlaubt LAN-Ziele schon in allen Versionen).
- Nachziehen: `?p=gsi&appcfg=1` (eingeloggt) liefert JSON `{token, cfg, uri}` mit dem aktuellen Inhalt, ohne aktiven
  Relay `{off: true}` (ohne `gsi_token`: `null`). Bei `off` ruft `assets/app.js` `removeGsi` auf. In der App
  ruft `assets/app.js` das beim Seitenaufruf auf (höchstens alle 5 min, `localStorage` `gsiCheck`) und gibt es an
  `updateGsi`. Gibt es noch keine Datei (`updated` leer, `unchanged` 0), installiert es sie per `installGsi`
  (ohne CS2 auf dem PC: Fehler, wird still ignoriert). Bei einer Änderung erscheint ein Hinweis „GSI-Datei
  aktualisiert/installiert … CS2 neu starten“. Heruntergeladene Dateien ohne App müssen die Spieler selbst neu holen.

## Versionen und Kompatibilität
- Die Website erkennt die App über die Existenz von `window.brtwrst` und prüft einzelne Funktionen
  per Feature-Detection (`window.brtwrst.players`, `window.brtwrst?.installGsi`, `window.brtwrst?.updateGsi`, `window.brtwrst.removeGsi`, `window.brtwrst.gsiRelay`).
- Festgelegte Mindestversion (Entscheidung Betreiber, 2026-11): **0.1.7** (Auto-Update geht ab 0.1.5).
  Bei gravierenden Schnittstellenänderungen wird sie angehoben. Ist `window.brtwrst.version` älter, zeigt
  `assets/app.js` (`MIN`) auf jeder Seite einen Hinweis zum Aktualisieren; gesperrt wird nichts.
- „Was ist neu“ (`data/changelog.md`) ist nach App-Versionen gegliedert; Website-Änderungen stehen unter
  „Seit App-Version X.Y.Z“, bis das nächste App-Release den Abschnitt abschließt (Regeln: `CLAUDE.md` beider Repos).
- Neue Bridge-Funktionen: zuerst in der App veröffentlichen, auf der Website nur mit Feature-Detection nutzen
  und einen Hinweis „bitte aktualisieren“ zeigen (Muster: `app/pages/gsi.php`).
- Download-Links der Website zeigen auf `github.com/bauerrrrrrr/brtwrst-app/releases/latest` und
  `bauerrrrrrr.github.io/brtwrst-app/` (Flatpak) (`app/pages/rcon.php`).
