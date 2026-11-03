#!/usr/bin/env bash
# Full engine build: dependencies, PSPP, bridge -> web/public/engine/.
# Requires emsdk:  source /path/to/emsdk/emsdk_env.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/build-deps.sh"
"$HERE/build-pspp.sh"
"$HERE/link.sh"
node "$HERE/../test/smoke.mjs"
