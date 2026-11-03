#!/usr/bin/env bash
# Builds PSPP's third-party dependencies as static WebAssembly libraries.
# Requires an activated emsdk (source emsdk_env.sh).
# Usage: engine/scripts/build-deps.sh [WORKDIR]   (default: engine/.build)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$ROOT/.build}"
PREFIX="$WORK/prefix"
SRC="$WORK/src"
JOBS="$(nproc)"
mkdir -p "$PREFIX" "$SRC"

GSL_VER=2.8
LIBXML2_VER=2.13.5
ZLIB_VER=1.3.1

export CFLAGS="-O2 -fPIC"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

fetch() { # url
  local f="$SRC/$(basename "$1")"
  [ -f "$f" ] || curl -fsSL "$1" -o "$f"
  tar -C "$SRC" -xf "$f"
}

# Old config.sub scripts do not know about Emscripten; use automake's.
refresh_config_sub() { # dir
  local am; am="$(ls -d /usr/share/automake-* | sort -V | tail -1)"
  find "$1" -name config.sub -exec cp "$am/config.sub" {} \;
  find "$1" -name config.guess -exec cp "$am/config.guess" {} \;
}

if [ ! -f "$PREFIX/lib/libz.a" ]; then
  fetch "https://zlib.net/fossils/zlib-$ZLIB_VER.tar.gz"
  (cd "$SRC/zlib-$ZLIB_VER" &&
     emconfigure ./configure --prefix="$PREFIX" --static &&
     emmake make -j"$JOBS" && emmake make install)
fi
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"

if [ ! -f "$PREFIX/lib/libgsl.a" ]; then
  fetch "https://ftp.gnu.org/gnu/gsl/gsl-$GSL_VER.tar.gz"
  refresh_config_sub "$SRC/gsl-$GSL_VER"
  (cd "$SRC/gsl-$GSL_VER" &&
     emconfigure ./configure --host=wasm32-unknown-emscripten \
       --prefix="$PREFIX" --disable-shared --enable-static &&
     emmake make -j"$JOBS" && emmake make install)
fi

if [ ! -f "$PREFIX/lib/libxml2.a" ]; then
  fetch "https://download.gnome.org/sources/libxml2/${LIBXML2_VER%.*}/libxml2-$LIBXML2_VER.tar.xz"
  refresh_config_sub "$SRC/libxml2-$LIBXML2_VER"
  (cd "$SRC/libxml2-$LIBXML2_VER" &&
     emconfigure ./configure --host=wasm32-unknown-emscripten \
       --prefix="$PREFIX" --disable-shared --enable-static \
       --without-python --without-threads --without-lzma --without-http \
       --without-ftp --without-modules --with-zlib &&
     emmake make -j"$JOBS" && emmake make install)
fi

echo "Dependencies installed in $PREFIX"
