#!/usr/bin/env bash
# Flatpak bauen: aus dist/linux-unpacked.tar.gz ein Flatpak-Repo in <ausgabe>/repo.
# Mit GPG-Schlüssel-ID (GNUPGHOME gesetzt) wird signiert und die Seite fürs Einbinden erzeugt.
#   scripts/flatpak-build.sh <version> <ausgabe> [gpg-id] [basis-url]
set -euo pipefail
V=$1 OUT=$2 GPG_ID=${3:-} BASE=${4:-}
APP=pw.wurst.brat.Brtwrst
cd "$(dirname "$0")/.."
mkdir -p "$OUT"

sed -e "s/@VERSION@/$V/" -e "s/@DATE@/$(date -u +%F)/" flatpak/$APP.metainfo.xml > flatpak/.metainfo.tmp
mv flatpak/.metainfo.tmp flatpak/$APP.metainfo.xml

SIGN=()
[ -n "$GPG_ID" ] && SIGN=(--gpg-sign="$GPG_ID" --gpg-homedir="$GNUPGHOME")
flatpak-builder --user --install-deps-from=flathub --disable-rofiles-fuse --force-clean \
  --default-branch=stable --repo="$OUT/repo" "${SIGN[@]}" .flatpak-build flatpak/$APP.yml
flatpak build-update-repo --prune --title="BRTWRST" "${SIGN[@]}" "$OUT/repo"

[ -n "$GPG_ID" ] || exit 0
KEY=$(gpg --dearmor < flatpak/brtwrst-flatpak.asc | base64 -w0)
cat > "$OUT/brtwrst.flatpakrepo" <<R
[Flatpak Repo]
Title=BRTWRST
Url=${BASE}repo/
Homepage=https://github.com/bauerrrrrrr/brtwrst-app
Comment=Team-Bratwurst-App mit RCON für die CS2-Server
GPGKey=$KEY
R
cat > "$OUT/brtwrst.flatpakref" <<R
[Flatpak Ref]
Name=$APP
Branch=stable
Title=BRTWRST
Url=${BASE}repo/
SuggestRemoteName=brtwrst
RuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo
IsRuntime=false
GPGKey=$KEY
R
cat > "$OUT/index.html" <<R
<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BRTWRST für Linux (Flatpak)</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;background:#111;color:#eee}a{color:#f2b134}code,pre{background:#222;padding:2px 6px;border-radius:4px}pre{padding:12px;overflow-x:auto}</style></head><body>
<h1>BRTWRST für Linux (Flatpak)</h1>
<p>Version $V. Updates kommen danach automatisch über Discover, GNOME Software oder <code>flatpak update</code>.</p>
<h2>Mit einem Klick</h2>
<p><a href="brtwrst.flatpakref">brtwrst.flatpakref herunterladen</a> und öffnen. Discover bzw. „Software“ fragt dann nach der Installation.</p>
<h2>Im Terminal</h2>
<pre>flatpak remote-add --user --if-not-exists brtwrst ${BASE}brtwrst.flatpakrepo
flatpak install --user brtwrst $APP</pre>
<p>Starten über das Startmenü oder mit <code>flatpak run $APP</code>.</p>
<p>Das Repo ist mit GPG signiert, Fingerabdruck: <code>$(gpg --with-colons --import-options show-only --import < flatpak/brtwrst-flatpak.asc | awk -F: '/^fpr/{print $10; exit}')</code></p>
</body></html>
R
