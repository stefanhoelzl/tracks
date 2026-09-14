#!/bin/bash
# Checks out BRouter v1.7.10 (the version brouter.de runs) into the cache, applies the spike's
# patches, and prints the source roots of the five routing-core modules plus the spike runner.
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${SPIKE_CACHE:-$HOME/spike-cache}
BR=$CACHE/brouter

if [ ! -d "$BR" ]; then
  git clone -q --depth 1 --branch v1.7.10 https://github.com/abrensch/brouter.git "$BR" >&2
fi
for p in "$SPIKE"/patches/*.patch; do
  if git -C "$BR" apply --check "$p" 2>/dev/null; then
    git -C "$BR" apply "$p"
  elif ! git -C "$BR" apply --reverse --check "$p" 2>/dev/null; then
    echo "patch does not apply: $p" >&2
    exit 1
  fi
done

for m in brouter-codec brouter-core brouter-expressions brouter-mapaccess brouter-util; do
  echo "$BR/$m/src/main/java"
done
echo "$SPIKE/java/src"
