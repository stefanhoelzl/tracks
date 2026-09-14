#!/bin/bash
# Runs the spike's measurements for one candidate, one simulator launch at a time and with nothing
# else running: an idle launch, every route in its own process (cold, then warm), and 20 repeats of
# the 27 km and the 176 km route. Builds the app first. Results land in build/results/<candidate>/.
#
# usage: measure.sh <j2objc|mobivm>
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CAND=$1
RUN=$SPIKE/scripts/run-sim.sh

rm -rf "$SPIKE/build/results/$CAND"

if [ "$CAND" = j2objc ]; then
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

"$RUN" "$CAND" idle SPIKE_MODE=idle
for id in $(cut -f1 "$SPIKE/routes.tsv"); do
  "$RUN" "$CAND" "route-$id" SPIKE_MODE=routes SPIKE_ROUTES="$id"
done
"$RUN" "$CAND" repeat-r1 SPIKE_MODE=repeat:r1-munich-starnberg:20
"$RUN" "$CAND" repeat-r2 SPIKE_MODE=repeat:r2-munich-innsbruck:20

python3 "$SPIKE/scripts/compare.py" "$SPIKE/fixtures/jvm" "$SPIKE/build/results/$CAND/geojson" || true
