#!/bin/sh
# Start im Flatpak: zypak stellt die Chromium-Sandbox bereit, CHROME_DESKTOP verknüpft Fenster und Starter-Symbol.
export CHROME_DESKTOP=pw.wurst.brat.Brtwrst.desktop
exec zypak-wrapper /app/brtwrst/brtwrst "$@"
