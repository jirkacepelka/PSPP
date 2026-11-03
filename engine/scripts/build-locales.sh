#!/usr/bin/env bash
# Compiles PSPP message catalogs for the UI languages into the web app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../web/public/engine/locale}"
for lang in ${LANGS:-cs}; do
  mkdir -p "$OUT/$lang"
  msgfmt -c --statistics -o "$OUT/$lang/pspp.mo" "$ROOT/pspp/po/$lang.po"
done
