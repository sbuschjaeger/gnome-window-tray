#!/usr/bin/env bash
# Build a locally installable extension zip and (optionally) install it.
#
#   ./scripts/pack.sh              build dist/*.zip
#   ./scripts/pack.sh --install    build and install into ~/.local/share/gnome-shell/extensions
#
# Every ES module imported by extension.js or prefs.js must be listed as an
# --extra-source, because `gnome-extensions pack` only auto-includes the entry
# points, stylesheet, metadata, and translations. The verification step at the end
# fails the build if an imported module is missing from the archive, so a new
# module cannot be silently left out again.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

UUID="window-tray@buschjaeger.github.io"
OUT="dist"

command -v gnome-extensions >/dev/null || {
    echo "gnome-extensions not found (install gnome-shell-common / gnome-shell)" >&2
    exit 1
}

mkdir -p "$OUT"
rm -f "$OUT"/*.zip

# Non-ESM assets also need explicit inclusion.
EXTRA=(
    --extra-source=config.js
    --extra-source=matching.js
    --extra-source=logging.js
    --extra-source=patchRegistry.js
    --extra-source=window-tray-symbolic.svg
)

gnome-extensions pack "$UUID" --force "${EXTRA[@]}" --out-dir="$OUT"

ZIP="$(ls -t "$OUT"/*.zip | head -1)"
echo "packed: $ZIP"

# --- verify: every module imported from './x.js' is present in the archive ----
CONTENTS="$(unzip -Z1 "$ZIP")"
missing=0
for imported in $(grep -rhoP "from '\./\K[a-zA-Z0-9_]+(?=\.js')" "$UUID"/*.js | sort -u); do
    if ! grep -qx "$imported.js" <<<"$CONTENTS"; then
        echo "MISSING from zip: $imported.js (add --extra-source=$imported.js)" >&2
        missing=1
    fi
done
for asset in window-tray-symbolic.svg stylesheet.css metadata.json; do
    grep -qx "$asset" <<<"$CONTENTS" || { echo "MISSING from zip: $asset" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || exit 1
echo "verified: $(grep -c . <<<"$CONTENTS") files, all imported modules present"

if [[ "${1:-}" == "--install" ]]; then
    gnome-extensions install --force "$ZIP"
    echo "installed. Restart GNOME Shell (X11: Alt+F2 r; Wayland: log out and in) to load it."
fi
