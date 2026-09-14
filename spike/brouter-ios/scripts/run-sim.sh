#!/bin/bash
# Installs a candidate's harness app in the iOS Simulator, launches it once per requested mode and
# keeps the SPIKE lines and GeoJSON it produced.
#
# usage: run-sim.sh <candidate> <label> [VAR=value ...]
#   e.g. run-sim.sh j2objc routes-r1 SPIKE_MODE=routes SPIKE_ROUTES=r1-munich-starnberg
#        run-sim.sh mobivm repeat-r1 SPIKE_MODE=repeat:r1-munich-starnberg:20
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CAND=$1
LABEL=$2
shift 2
APP=$SPIKE/build/$CAND/SpikeHarness.app
BUNDLE=eu.tracks.spike.brouter
DEVICE_NAME=${SPIKE_DEVICE:-iPhone 17 Pro}
RESULTS=$SPIKE/build/results/$CAND
mkdir -p "$RESULTS"

UDID=$(xcrun simctl list devices available -j |
  python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(x['udid'] for r in d.values() for x in r if x['name']==sys.argv[1]))" "$DEVICE_NAME")
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

ENVS=()
for kv in "$@"; do ENVS+=("SIMCTL_CHILD_$kv"); done

# --console-pty streams the app's stdout and returns when the app exits.
env ${ENVS[@]+"${ENVS[@]}"} xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" 2>&1 |
  tr -d '\r' | tee "$RESULTS/$LABEL.log" | grep '^SPIKE ' | sed 's/^SPIKE //' > "$RESULTS/$LABEL.jsonl" || true

DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
if [ -d "$DATA/Documents/out" ]; then
  mkdir -p "$RESULTS/geojson"
  cp "$DATA"/Documents/out/*.geojson "$RESULTS/geojson/" 2>/dev/null || true
fi
grep -c '"event"' "$RESULTS/$LABEL.jsonl" >/dev/null && tail -3 "$RESULTS/$LABEL.jsonl"
