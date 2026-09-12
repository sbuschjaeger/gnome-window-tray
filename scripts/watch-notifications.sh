#!/usr/bin/env bash
# Watch what GNOME Shell associates with incoming notifications.
# Useful when an app's notification does not restore its window: it shows the
# desktop ID and WM class that Window Tray actually sees.
set -euo pipefail

echo "Watching notifications. Press Ctrl+C to stop."
journalctl -f -o cat _COMM=gnome-shell \
    | grep --line-buffered -Ei "Window Tray|notification"
