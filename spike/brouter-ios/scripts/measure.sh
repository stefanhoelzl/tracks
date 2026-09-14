#!/bin/bash
# Runs the spike's measurements for one candidate, one simulator launch at a time and with nothing
# else running: an idle launch, every route in its own process (cold, then warm), and 20 repeats of
# the 27 km and the 176 km route. Builds the app first. Results land in build/results/<name>/, where
# the name is SPIKE_RESULTS or the candidate.
#
# usage: measure.sh <j2objc|mobivm> [quick]
#   quick: only r1 and r2, plus both repeat series (for leak experiments)
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CAND=$1
MODE=${2:-full}
RUN=$SPIKE/scripts/run-sim.sh
export SPIKE_RESULTS=${SPIKE_RESULTS:-$CAND}

rm -rf "$SPIKE/build/results/$SPIKE_RESULTS"

if [ "$CAND" = j2objc ] && [ "$MODE" = full ]; then
  # The lean link (jre_core subset, dead-stripped) only for its size and a smoke route; the runs
  # use J2ObjC's documented default.
  if J2OBJC_LINK=lean "$SPIKE/scripts/build-app.sh" j2objc; then
    "$RUN" j2objc lean-smoke SPIKE_MODE=routes SPIKE_ROUTES=r4-salzburg-hallein || true
  else
    echo "lean link failed; measuring the full link only"
  fi
  J2OBJC_LINK=full "$SPIKE/scripts/build-app.sh" j2objc
else
  "$SPIKE/scripts/build-app.sh" "$CAND"
fi

if [ "$MODE" = full ]; then
  "$RUN" "$CAND" idle SPIKE_MODE=idle
  IDS=$(cut -f1 "$SPIKE/routes.tsv")
else
  IDS="r1-munich-starnberg r2-munich-innsbruck"
fi
for id in $IDS; do
  "$RUN" "$CAND" "route-$id" SPIKE_MODE=routes SPIKE_ROUTES="$id"
done
"$RUN" "$CAND" repeat-r1 SPIKE_MODE=repeat:r1-munich-starnberg:20
"$RUN" "$CAND" repeat-r2 SPIKE_MODE=repeat:r2-munich-innsbruck:20

python3 "$SPIKE/scripts/compare.py" "$SPIKE/fixtures/jvm" "$SPIKE/build/results/$SPIKE_RESULTS/geojson" || true
