#!/bin/bash
# Rebuilds the generated half of app/brouter — btools/{codec,expressions,mapaccess,router,util} —
# from J2K's untouched output plus the fix passes, in order.
#
#   ./replay.sh           write the result into src/commonMain/kotlin (after convert.sh)
#   ./replay.sh --check   build it in a scratch directory and diff it against the committed tree
#
# Nothing under those five packages is edited by hand: a change there is a change to a pass,
# recorded as a patch in patches/kotlin/ (record-pass.sh). `--check` is how that is kept true.
# The hand-written btools/kmp and net/stho/tracks are left alone either way.
#
# A patch that no longer applies names the pass that needs rebasing onto a new BRouter release.
#
# Env: J2K_RAW  J2K's output (default: where convert.sh writes it)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
COMMITTED=$(cd "$HERE/.." && pwd)/src/commonMain/kotlin
RAW=${J2K_RAW:-${TRACKS_CACHE:-$HOME/.cache/tracks}/j2k/raw-perfile}
MODULES="brouter-codec brouter-core brouter-expressions brouter-mapaccess brouter-util"
PACKAGES="btools/codec btools/expressions btools/mapaccess btools/router btools/util"
# Standalone tools with their own main(), not on the routing path.
EXCLUDED="btools/mapaccess/Rd5DiffManager.kt btools/mapaccess/Rd5DiffTool.kt btools/mapaccess/Rd5DiffValidator.kt
btools/expressions/ProfileComparator.kt btools/expressions/IntegrityCheckProfile.kt"

[ -d "$RAW" ] || { echo "no J2K output at $RAW — run convert.sh first, or set J2K_RAW" >&2; exit 1; }

if [ "${1:-}" = --check ]; then
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
else
  SRC=$COMMITTED
fi

for p in $PACKAGES; do rm -rf "${SRC:?}/$p"; done
mkdir -p "$SRC"
for m in $MODULES; do cp -r "$RAW/$m/." "$SRC/"; done
for f in $EXCLUDED; do rm -f "$SRC/$f"; done

for p in "$HERE"/patches/kotlin/*.patch; do
  patch -s -p1 -d "$SRC" --no-backup-if-mismatch < "$p" || { echo "does not apply: $(basename "$p")" >&2; exit 1; }
done
echo "applied $(ls "$HERE"/patches/kotlin/*.patch | wc -l) passes"

if [ "${1:-}" = --check ]; then
  for p in $PACKAGES; do
    diff -r "$SRC/$p" "$COMMITTED/$p" || { echo "the committed tree is not what the passes produce" >&2; exit 1; }
  done
  echo "the committed tree is exactly J2K's output plus the passes"
fi
