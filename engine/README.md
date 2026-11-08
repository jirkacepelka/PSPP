# PSPP Studio – engine

GNU PSPP 2.1.3 (`pspp/`) compiled to WebAssembly, headless and without Cairo.

| Path | What |
|---|---|
| `pspp/` | Fork of the upstream sources. Changes on top of 2.1.3: optional Cairo (`--without-cairo`), `html_table_to_string()`, Emscripten portability fixes. See `git log -- engine/pspp`. |
| `bridge/` | C API over libpspp exported to JS: build the active dataset, run syntax (output as JSON, tables as HTML, charts as data), read the dataset back. |
| `js/engine.mjs` | JS wrapper implementing the front end's `EngineApi` (open/save/run). |
| `scripts/` | `build-deps.sh` (zlib, gsl, libxml2), `build-pspp.sh`, `link.sh`, `build-all.sh`. |
| `test/smoke.mjs` | End-to-end test in Node. |

## Build

```bash
git clone https://github.com/emscripten-core/emsdk.git && ./emsdk/emsdk install latest && ./emsdk/emsdk activate latest
source ./emsdk/emsdk_env.sh
engine/scripts/build-all.sh
```

Host tools needed: autoconf, automake, libtool, gettext, texinfo, gperf, pkg-config, curl.
The output (`web/public/engine/pspp.{js,wasm}`) is committed, so the web app can
be built and deployed without Emscripten.

License: GPL-3.0-or-later, like GNU PSPP.
