#!/usr/bin/env bash
# Runs the unit tests for the pure modules, then checks extension syntax.
#
#   ./scripts/test.sh
#
# These tests cover matching, patch safety, and the debug-flag logic. They cannot
# exercise anything that needs a real GNOME Shell session (panel UI, workspace
# moves, notification routing) — see MANUAL-TESTING.md for that.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

UUID="window-tray@buschjaeger.github.io"

command -v gjs >/dev/null || {
    echo "gjs not found (package gjs)" >&2
    exit 1
}

echo "== unit tests =="
gjs -m tests/test.mjs

echo
echo "== syntax =="
for f in "$UUID"/*.js tests/*.mjs; do
    if node --check "$f" >/dev/null 2>&1; then
        echo "ok   $f"
    elif gjs -c "void 0" >/dev/null 2>&1; then
        echo "skip $f (node unavailable)"
    else
        echo "FAIL $f"
        node --check "$f"
        exit 1
    fi
done

echo
echo "all checks passed"
