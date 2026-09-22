#!/bin/bash
# Measures what riding costs on a real iPhone: runs a plan of measured launches, one after the other, and pulls each
# run's samples back. What the numbers mean and how to read them: app/docs/PROFILING.md.
#
#   ./ride-measure.sh [--ipa <app.ipa>] [--gpx <ride.gpx>] <plan> [results-dir]
#
# A plan is a text file, one run per line:
#
#   # comment
#   base                                       <label> then any launch switches, KEY=VALUE
#   cap-off     TRACKS_MAX_FPS=0
#   say Pick the phone up and sway it          shown as a notification in CodeHydra, then 20 s to act on it
#
# Every run replays the ride from the same depth (RIDE_SEED, default 15000 fixes) for RIDE_HOLD seconds (default 100)
# unless its line says otherwise. --ipa installs that build first; --gpx pushes a ride into the app's Documents and
# replays it instead of the bundled one (after --ipa, since an install is not trusted to keep Documents).
#
# Before: the build is signed for this phone (the ios-device skill), the phone is unlocked and on USB, and this
# workspace holds the device lease.
#
# Results: <results-dir>/<label>.jsonl, one per run, and a log. Then: ./ride-table.py <results-dir>
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BUNDLE=net.stho.tracks
P="uvx --python 3.14 pymobiledevice3"
HOLD=${RIDE_HOLD:-100}
SEED=${RIDE_SEED:-15000}
IPA= GPX=
while [ $# -gt 0 ]; do
  case "$1" in
    --ipa) IPA=$2; shift 2 ;;
    --gpx) GPX=$2; shift 2 ;;
    *) break ;;
  esac
done
PLAN=${1:?usage: ride-measure.sh [--ipa <app.ipa>] [--gpx <ride.gpx>] <plan> [results-dir]}
OUT=${2:-$HERE/build/ride-measure-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1
log() { echo "$(date +%T) $*"; }

kill_app() {
  local pid
  pid=$(timeout 40 $P developer dvt process-id-for-bundle-id $BUNDLE --userspace 2>&1 | grep -oE '^[0-9]+$' | tail -1)
  [ -n "$pid" ] && [ "$pid" != 0 ] && timeout 30 $P developer dvt signal "$pid" 9 --userspace >/dev/null 2>&1
  return 0
}

say() {
  log ">>> $*"
  command -v ch >/dev/null && { ch ws notify "$*" >/dev/null 2>&1; ch ws status-bar "$*" >/dev/null 2>&1; }
  sleep 20
}

if [ -n "$IPA" ]; then
  kill_app
  log "install $IPA"
  ~/.claude/skills/ios-device/install "$IPA" 2>&1 | tail -1
fi
GPX_NAME=
if [ -n "$GPX" ]; then
  GPX_NAME=$(basename "$GPX")
  timeout 120 $P apps push $BUNDLE "$GPX" "Documents/$GPX_NAME" >/dev/null 2>&1 || { log "GPX push failed"; exit 1; }
  log "pushed $GPX_NAME"
fi

# One measured launch: the ride starts at launch, samples every 5 s into Documents/out/ride-<label>.jsonl.
run() {
  local label=$1; shift
  kill_app
  local env=(--env "TRACKS_RIDE_MEASURE=$label" --env "TRACKS_SEED=$SEED")
  [ -n "$GPX_NAME" ] && env+=(--env "TRACKS_GPX=$GPX_NAME")
  for kv in "$@"; do env+=(--env "$kv"); done
  log "=== $label $*"
  timeout 90 $P developer dvt launch "${env[@]}" $BUNDLE --userspace >/dev/null 2>&1 || { log "    launch failed"; return; }
  sleep "$HOLD"
  rm -f "$OUT/$label.jsonl"
  timeout 120 $P apps pull $BUNDLE "Documents/out/ride-$label.jsonl" "$OUT/$label.jsonl" >/dev/null 2>&1
  log "    $(grep -c . "$OUT/$label.jsonl" 2>/dev/null || echo 0) samples"
}

# The plan is read on its own descriptor: pymobiledevice3 reads stdin, and would eat the lines after its own.
while read -r first rest <&3; do
  case "$first" in
    ''|'#'*) continue ;;
    say) say "$rest" ;;
    *) run "$first" $rest ;;
  esac
done 3< "$PLAN"
kill_app
log "done: $OUT"
