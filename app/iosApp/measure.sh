#!/bin/bash
# Measures the converted BRouter on a real iPhone: every parity route cold and warm, then long routes back to
# back until the phone is warm, with time, peak footprint, memory growth and thermal state — and checks that
# every route's GeoJSON is still brouter.de's.
#
#   ./measure.sh [results-dir]
#   MEASURE_ROUTES=id,id MEASURE_REPEATS=0 ./measure.sh    only those routes, and no back-to-back series
#
# Before: the app is installed (the ios-device skill: build on the macOS runner, sign, install), the phone is
# unlocked, and this workspace holds the device lease. The tile snapshot is taken from the parity cache
# (~/.cache/tracks/segments, which `gradlew :brouter:paritySegments` fills) and pushed into the app's
# Documents/segments, where downloaded tiles will live (M13).
#
# Results: <results-dir>/<run>/measure.jsonl and geojson/, and a summary on stdout.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/.." && pwd)
BUNDLE=net.stho.tracks
P="uvx --python 3.14 pymobiledevice3"
OUT=${1:-$APP/iosApp/build/measure-$(date +%Y%m%d-%H%M%S)}
PARITY=$APP/brouter/parity
SNAPSHOT=$(sed -n 's/^release //p' "$PARITY/segments.txt")
SEGMENTS=${TRACKS_CACHE:-$HOME/.cache/tracks}/segments/$SNAPSHOT
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
log() { echo "$(date +%T) $*"; }

pid_of() {
  timeout 30 $P developer dvt process-id-for-bundle-id $BUNDLE --userspace 2>&1 | grep -oE '^[0-9]+$' | tail -1
}

kill_app() {
  local pid
  pid=$(pid_of)
  [ -n "$pid" ] && [ "$pid" != 0 ] && timeout 20 $P developer dvt signal "$pid" 9 --userspace >/dev/null 2>&1
  return 0
}

pull_jsonl() {
  rm -f "$TMP/measure.jsonl"
  timeout 60 $P apps pull $BUNDLE Documents/out/measure.jsonl "$TMP/measure.jsonl" >/dev/null 2>&1
  [ -f "$TMP/measure.jsonl" ] || touch "$TMP/measure.jsonl"
}

# One launch in one mode. The app appends to Documents/out/measure.jsonl across launches, so the end of a run
# is a new "done" line, and only the lines after this launch are kept.
run() {
  local label=$1 mode=$2 routes=${3:-}
  local dir=$OUT/$label
  mkdir -p "$dir/geojson"
  kill_app
  pull_jsonl
  local lines done_before
  lines=$(wc -l < "$TMP/measure.jsonl")
  done_before=$(grep -c '"event":"done"' "$TMP/measure.jsonl")
  local env=(--env "TRACKS_MEASURE=$mode")
  [ -n "$routes" ] && env+=(--env "TRACKS_ROUTES=$routes")
  log "launch $label ($mode)"
  timeout 60 $P developer dvt launch "${env[@]}" $BUNDLE --userspace >/dev/null 2>&1 || { log "launch failed: is the phone unlocked?"; return 1; }
  local start
  start=$(date +%s)
  while :; do
    sleep 15
    pull_jsonl
    [ "$(grep -c '"event":"done"' "$TMP/measure.jsonl")" -gt "$done_before" ] && break
    if [ "$(pid_of)" = 0 ]; then
      # The app may have written "done" and exited between the pull above and this lookup: look once more.
      pull_jsonl
      [ "$(grep -c '"event":"done"' "$TMP/measure.jsonl")" -gt "$done_before" ] && break
      log "$label: the app exited without finishing (crash? see crash reports)"
      break
    fi
    [ $(( $(date +%s) - start )) -gt 3000 ] && { log "$label: timed out"; break; }
  done
  tail -n +$((lines + 1)) "$TMP/measure.jsonl" > "$dir/measure.jsonl"
  if [ "$mode" = routes ]; then
    for id in ${routes//,/ }; do
      timeout 60 $P apps pull $BUNDLE "Documents/out/$id.geojson" "$dir/geojson/$id.geojson" >/dev/null 2>&1 || true
    done
  fi
  log "$label done after $(( $(date +%s) - start ))s"
}

# 1. A plain launch creates Documents/segments; then the tiles go in.
log "preparing the phone"
kill_app
timeout 60 $P developer dvt launch $BUNDLE --userspace >/dev/null 2>&1
sleep 5
kill_app
for tile in $(grep -oE '[A-Z0-9_]+\.rd5' "$PARITY/segments.txt"); do
  [ -f "$SEGMENTS/$tile" ] || { echo "no $SEGMENTS/$tile: run ../gradlew :brouter:paritySegments first" >&2; exit 1; }
  log "pushing $tile"
  timeout 600 $P apps push $BUNDLE "$SEGMENTS/$tile" "Documents/segments/$tile" >/dev/null 2>&1 || { echo "push of $tile failed" >&2; exit 1; }
done

# 2. Every route, each in a launch of its own so its first run is cold.
for id in $(cut -f1 "$PARITY/routes.tsv"); do
  [ -z "${MEASURE_ROUTES:-}" ] || [[ ",$MEASURE_ROUTES," == *",$id,"* ]] || continue
  run "route-$id" routes "$id"
done

# 3. Long routes back to back: memory growth, and what heat does to the time.
if [ "${MEASURE_REPEATS:-1}" != 0 ]; then
  run repeat-trekking-munich-innsbruck repeat:trekking-munich-innsbruck:20
  run repeat-trekking-munich-bolzano repeat:trekking-munich-bolzano:10
fi

# 4. Parity on the phone, and the numbers.
python3 - "$OUT" "$PARITY" <<'EOF'
import json, pathlib, statistics, sys
out, parity = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

def lines(d):
    f = d / 'measure.jsonl'
    return [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []

def strip(text):
    return [l for l in text.splitlines() if '"creator":' not in l]

start = next((r for d in sorted(out.iterdir()) if d.is_dir() for r in lines(d) if r.get('event') == 'start'), {})
print(f"device {start.get('machine')} {start.get('os')}, {start.get('physicalMemoryMB')} MB, engine BRouter {start.get('engine')}")
print(f"\n{'route':<38}{'cold s':>8}{'warm s':>8}{'peak MB':>9}{'avail MB':>10}  thermal  parity")
same = total = 0
for d in sorted(out.glob('route-*')):
    rs = [r for r in lines(d) if r.get('event') == 'route']
    rid = d.name[len('route-'):]
    if not rs:
        print(f'{rid:<38} no data'); total += 1; continue
    err = next((r['error'] for r in rs if 'error' in r), None)
    g = d / 'geojson' / f'{rid}.geojson'
    ok = g.exists() and strip(g.read_text()) == strip((parity / 'brouter.de' / f'{rid}.geojson').read_text())
    same += ok; total += 1
    warm = rs[1]['ms'] / 1000 if len(rs) > 1 else float('nan')
    print(f"{rid:<38}{rs[0]['ms']/1000:>8.2f}{warm:>8.2f}{max(r['peakDuringMB'] for r in rs):>9.1f}"
          f"{min(r['availableMB'] for r in rs):>10.0f}  {rs[-1]['thermal']:<8} {'same' if ok else 'DIFFERS'}"
          + (f'  ERROR {err[:80]}' if err else ''))
print(f'\nparity on the phone: {same} / {total} byte-identical to brouter.de (creator aside)')
for d in sorted(out.glob('repeat-*')):
    rs = [r for r in lines(d) if r.get('event') == 'repeat']
    if not rs:
        print(f'\n{d.name}: no data'); continue
    ms = [r['ms'] / 1000 for r in rs]
    heat = next((r['run'] for r in rs if r['thermal'] != 'nominal'), None)
    print(f"\n{d.name} ({len(rs)} runs): {ms[0]:.2f} -> {ms[-1]:.2f} s, median {statistics.median(ms):.2f}, max {max(ms):.2f}; "
          f"peak {max(r['peakDuringMB'] for r in rs):.1f} MB; settled {rs[0]['footprintSettledMB']} -> {rs[-1]['footprintSettledMB']} MB; "
          f"thermal {' -> '.join(dict.fromkeys(r['thermal'] for r in rs))}" + (f' (from run {heat})' if heat is not None else ''))
EOF
log "results in $OUT"
