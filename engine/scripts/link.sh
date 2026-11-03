#!/usr/bin/env bash
# Links the bridge (engine/bridge) with the static PSPP libraries into an
# ES module + .wasm that the web front end loads in a Web Worker.
# Usage: engine/scripts/link.sh [WORKDIR] [OUTDIR]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$ROOT/.build}"
OUT="${2:-$ROOT/../web/public/engine}"
PREFIX="$WORK/prefix"
B="$WORK/pspp"
mkdir -p "$OUT"

OPT="${OPT:--O2}"

emcc $OPT \
  -I"$B" -I"$B/gl" -I"$B/src" -I"$ROOT/pspp" -I"$ROOT/pspp/gl" \
  -I"$ROOT/pspp/src" -I"$PREFIX/include" -I"$PREFIX/include/libxml2" \
  "$ROOT/bridge/bridge.c" "$ROOT/bridge/chart-json.c" \
  "$B/src/.libs/libpspp.a" "$B/src/.libs/libpspp-core.a" \
  "$B/gl/.libs/libgl.a" \
  -L"$PREFIX/lib" -lgsl -lgslcblas -lxml2 -lz \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPspp \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=4MB \
  -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap,UTF8ToString,stringToNewUTF8,HEAPF64 \
  -o "$OUT/pspp.js"

ls -la "$OUT"
