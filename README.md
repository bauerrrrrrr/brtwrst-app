# BRTWRST

Das Team-Bratwurst-Intranet als App für **Windows, Linux und macOS**, mit direktem **RCON** und **LAN-Scan** für die CS2-Server auf der MTA-LAN.

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
npm run dist:linux                          # AppImage in dist/
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
| `src/gsi.js` | GSI-Datei in die CS2-cfg-Ordner legen |
| `src/updater.js` | signierte Updates (Windows, AppImage) |
| `src/flatpak.js`, `src/dbus.js` | Update im Flatpak über das Flatpak-Portal (eigener kleiner D-Bus-Client) |
| `flatpak/` | Flatpak-Manifest, Starter, Metainfo, öffentlicher GPG-Schlüssel des Repos |
| `test/` | Tests mit simuliertem CS2-Server |

## Releases und Updates

```sh
npm version 0.1.2 --no-git-tag-version   # Version in package.json erhöhen
git commit -am "BRTWRST 0.1.2: <was neu ist>" && git push
```

Der Workflow merkt bei jedem Push auf main, ob es zur Version in `package.json` schon einen Tag gibt. Wenn nicht, baut er alles und legt Tag und Release selbst an. Die Betreffzeile des Commits wird zum Update-Text, den die App anzeigt. Ein von Hand gepushter Tag `v1.2.3` funktioniert weiterhin.

GitHub Actions (`.github/workflows/release.yml`) baut dann:
- **Tests:** Sie laufen zuerst.
- **Linux:** ein AppImage (aktualisiert sich selbst) und ein Flatpak.
- **Flatpak-Repo:** GPG-signiert (Secret `BRTWRST_FLATPAK_GPG_KEY`, öffentlicher Schlüssel `flatpak/brtwrst-flatpak.asc`), veröffentlicht auf GitHub Pages: <https://bauerrrrrrr.github.io/brtwrst-app/>. Das Repo ist schon aktualisiert, bevor das Release erscheint.
- **Windows:** einen Installer (NSIS).
- **macOS:** `.dmg` zum Installieren und `.zip` für Updates, nur für Apple Silicon (`arm64`, M1 und neuer), Intel-Macs bewusst nicht. Nur ad-hoc signiert, nicht notarisiert: Der erste Start muss in den Systemeinstellungen unter Datenschutz & Sicherheit mit „Trotzdem öffnen“ erlaubt werden.
- **Manifest:** `manifest.json` mit Größe und SHA-256 jeder Datei, signiert mit Ed25519 (`manifest.json.sig`), danach das GitHub-Release.

**Wie die App aktualisiert:** 10 Sekunden nach dem Start und danach alle 4 Stunden, außerdem über das Menü „Nach Updates suchen“, holt sie sich `releases/latest/download/manifest.json`.
1. Sie prüft die Signatur mit dem eingebauten öffentlichen Schlüssel (`src/update-key.js`).
2. Sie nimmt nur höhere Versionen und lädt die passende Datei.
3. Sie prüft Größe und SHA-256 der Datei.
4. Sie fragt: „Jetzt neu starten?“

Danach je nach System:
- **Windows:** Der Installer läuft still (`/S`) und startet die App neu.
- **macOS:** Die App entpackt das `.zip` mit `ditto`, tauscht die laufende `.app` aus (die alte bleibt als `alt.app` im Update-Ordner) und startet neu. Liegt die App an einem Ort ohne Schreibrechte, kommt ein Hinweis.
- **Linux (AppImage):** Die neue Datei ersetzt die alte, die alte bleibt als `.AppImage.bak` liegen.
- **Linux (Flatpak):** Die App lädt selbst nichts. Sie fragt „Jetzt aktualisieren?“ und lässt Flatpak die neue Version über das Flatpak-Portal aus unserem Repo installieren; danach Neustart. Klappt das nicht (z. B. weil die neue Version mehr Rechte braucht), kommt der Hinweis auf Discover / `flatpak update`. Unabhängig davon aktualisieren Discover und GNOME Software das Flatpak wie jedes andere.
- **Linux, weder AppImage noch Flatpak** (z. B. `npm start`): Die App zeigt nur einen Hinweis mit Download-Link.

**Flatpak einbinden:**

```sh
flatpak remote-add --user --if-not-exists brtwrst https://bauerrrrrrr.github.io/brtwrst-app/brtwrst.flatpakrepo
flatpak install --user brtwrst pw.wurst.brat.Brtwrst
```

Rechte in der Sandbox: Netzwerk, Anzeige (Wayland/X11, GPU) und Schreibzugriff nur auf die Steam-Ordner im Home (`~/.local/share/Steam`, `~/.steam`, Steam als Flatpak) für die GSI-Datei. Liegt CS2 auf einer anderen Platte, die Datei von der GSI-Seite herunterladen.

**Probelauf:** `.github/workflows/flatpak-check.yml` baut und installiert das Flatpak bei Änderungen an `flatpak/` auf main, ohne etwas zu veröffentlichen.

**Signaturschlüssel:** Der private Schlüssel liegt nur als Repository-Secret `BRTWRST_SIGNING_KEY` vor, im Format PEM (PKCS#8). Geht er verloren, braucht es ein neues Schlüsselpaar und eine App-Version mit dem neuen öffentlichen Schlüssel. Diese müssen alle einmal von Hand installieren.
