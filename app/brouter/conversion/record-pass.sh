#!/bin/bash
# Records one fix pass as a patch in patches/kotlin/.
#
#   ./record-pass.sh --init                   snapshot the generated packages as they stand
#   ./record-pass.sh 06-peninsula-loop        after the pass's edits: write the diff as a patch
#
# The usual shape: `replay.sh` (every existing pass applied), `record-pass.sh --init`, run the new
# pass's script from passes/ (which names each edit and how many it expects), check it compiles and
# keeps parity, then `record-pass.sh <nn-name>`. `replay.sh --check` should pass afterwards.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/.." && pwd)/src/commonMain/kotlin
SNAP=${TRACKS_CACHE:-$HOME/.cache/tracks}/j2k/pass-snapshot
PACKAGES="btools/codec btools/expressions btools/mapaccess btools/router btools/util"

copy() {
  rm -rf "$1" && mkdir -p "$1/btools"
  for p in $PACKAGES; do cp -r "$SRC/$p" "$1/btools/"; done
}

if [ "${1:-}" = --init ]; then
  copy "$SNAP/last"
  echo "snapshot taken"
  exit 0
fi

name=${1:?usage: record-pass.sh --init | <nn-name>}
[ -d "$SNAP/last" ] || { echo "no snapshot: run record-pass.sh --init before the edits" >&2; exit 1; }
copy "$SNAP/cur"
out=$HERE/patches/kotlin/$name.patch
(cd "$SNAP" && diff -ruN last cur > "$out") || true
# One path prefix for both sides, so `patch -p1` applies it inside src/commonMain/kotlin.
sed -i -E 's#^(---|\+\+\+) (last|cur)/([^\t]*)\t.*#\1 x/\3#' "$out"
rm -rf "$SNAP/last" && mv "$SNAP/cur" "$SNAP/last"
echo "$name: $(grep -c '^+++ ' "$out") files, $(grep -c '^@@' "$out") hunks"
