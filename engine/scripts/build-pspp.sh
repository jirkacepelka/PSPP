#!/usr/bin/env bash
# Configures and builds the patched PSPP sources (engine/pspp) as static
# WebAssembly libraries, headless and without Cairo.
# Requires an activated emsdk and engine/scripts/build-deps.sh to have run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$ROOT/.build}"
PREFIX="$WORK/prefix"
BUILD="$WORK/pspp"
NLS="${NLS:-yes}"
mkdir -p "$BUILD"

PSPP_CFLAGS="-O2"

if [ ! -f "$ROOT/pspp/configure" ] || [ "$ROOT/pspp/configure.ac" -nt "$ROOT/pspp/configure" ]; then
  (cd "$ROOT/pspp" && autoreconf -fi)
fi

cd "$BUILD"
if [ ! -f Makefile ]; then
  # Passing both --build and --host forces cross-compilation mode, so
  # configure never tries to run test programs under Node.
  # musl (Emscripten's libc) implements gettext itself, but configure's probe
  # looks for GNU libc internals, so tell it the libc version is usable.
  export gt_cv_func_gnugettext1_libc=yes gt_cv_func_gnugettext2_libc=yes
  EM_PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" \
  LIBXML2_CFLAGS="-I$PREFIX/include/libxml2" LIBXML2_LIBS="-L$PREFIX/lib -lxml2 -lz" \
  GSL_CFLAGS="-I$PREFIX/include" GSL_LIBS="-L$PREFIX/lib -lgsl -lgslcblas" \
  CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib" CFLAGS="$PSPP_CFLAGS" \
  emconfigure "$ROOT/pspp/configure" \
    --build="$("$ROOT/pspp/build-aux/config.guess")" \
    --host=wasm32-unknown-emscripten \
    --prefix=/pspp \
    --without-gui --without-cairo --without-libpq --without-perl-module \
    $([ "$NLS" = yes ] && echo --enable-nls || echo --disable-nls) \
    --disable-rpath --disable-shared --enable-static
fi

emmake make -j"$(nproc)" CFLAGS="$PSPP_CFLAGS" built-sources
emmake make -j"$(nproc)" CFLAGS="$PSPP_CFLAGS" src/libpspp-core.la src/libpspp.la
