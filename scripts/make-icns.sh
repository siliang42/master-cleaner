#!/usr/bin/env bash
# Builds build/icon.icns from the rendered build/icon.png.
#
# electron-builder otherwise derives (and caches) its own icns from build resources,
# which can lag behind a freshly rendered icon. Shipping the icns explicitly keeps
# Dock / Launchpad visuals identical to the artwork in build/icon.png.
#
# Usage: bash scripts/make-icns.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/icon.png"
OUT="$ROOT/build/icon.icns"
SET="$(mktemp -d "${TMPDIR:-/tmp}/mc-icon.XXXXXX")"
trap 'rm -rf "$SET"' EXIT

if [ ! -f "$SRC" ]; then
  echo "missing $SRC" >&2
  exit 1
fi

mkdir -p "$SET/icon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SRC" --out "$SET/icon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$SRC" --out "$SET/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$SET/icon.iconset" -o "$OUT"
echo "wrote $OUT"
