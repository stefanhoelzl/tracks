#!/bin/bash
# Refreshes the parity fixtures from brouter.de: the GeoJSON it answers for every route in routes.tsv,
# and the rd5 snapshot it answered from.
#
#   ./fetch.sh
#
# Run it when BRouter releases or routes.tsv changes — not on a schedule. brouter.de is one enthusiast's
# server: requests go one at a time, ten seconds apart, and say who is asking.
#
# The fixtures only mean something against the tiles the server routed them on, and brouter.de rebuilds
# its tiles weekly. So the snapshot is taken from the server's current tiles (reused from the cache when
# its Last-Modified matches), and the server's Last-Modified is checked again after the last request: a
# rebuild in between aborts, and you run it again.
#
# Afterwards: publish the snapshot as the release named in segments.txt (the command is printed), run
# the parity tests, and commit brouter.de/ and segments.txt together.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SERVER=https://brouter.de/brouter
AGENT="tracks parity fixtures (https://github.com/stefanhoelzl/tracks)"
TILES="E5_N45 E10_N45"
PAUSE=10

modified() { curl -fsSI -A "$AGENT" "$SERVER/segments4/$1.rd5" | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p'; }

stamp=""
for t in $TILES; do
  m=$(modified "$t")
  [ -z "$stamp" ] || [ "$stamp" = "$m" ] || { echo "the server's tiles differ in age ($stamp, $m): try later" >&2; exit 1; }
  stamp=$m
  sleep 2
done
snapshot=brouter-segments-$(date -u -d "$stamp" +%F)
cache=${TRACKS_CACHE:-$HOME/.cache/tracks}/segments/$snapshot
echo "server tiles: $stamp -> $snapshot"

mkdir -p "$cache"
for t in $TILES; do
  if [ ! -f "$cache/$t.rd5" ]; then
    curl -fsS -A "$AGENT" -o "$cache/$t.rd5.part" "$SERVER/segments4/$t.rd5"
    mv "$cache/$t.rd5.part" "$cache/$t.rd5"
    sleep "$PAUSE"
  fi
done

mkdir -p "$HERE/brouter.de"
while IFS=$'\t' read -r id profile lonlats; do
  [ -n "$id" ] || continue
  query=$(python3 -c 'import sys, urllib.parse as u; print(u.urlencode({"lonlats": sys.argv[1], "profile": sys.argv[2], "alternativeidx": "0", "format": "geojson"}))' "$lonlats" "$profile")
  echo "$id"
  curl -fsS -A "$AGENT" -o "$HERE/brouter.de/$id.geojson.part" "$SERVER?$query"
  mv "$HERE/brouter.de/$id.geojson.part" "$HERE/brouter.de/$id.geojson"
  sleep "$PAUSE"
done < "$HERE/routes.tsv"

for t in $TILES; do
  [ "$(modified "$t")" = "$stamp" ] || { echo "brouter.de rebuilt $t while fetching: run again" >&2; exit 1; }
  sleep 2
done

{
  echo "# brouter.de's rd5 tiles of $stamp, which brouter.de/ was answered from."
  echo "# Published as a release of this repository; Gradle fetches it into the cache."
  echo "release $snapshot"
  (cd "$cache" && for t in $TILES; do sha256sum "$t.rd5"; done)
} > "$HERE/segments.txt"

echo
echo "fixtures and segments.txt written. Publish the snapshot if it is new:"
echo "  gh release create $snapshot $cache/*.rd5 --title \"$snapshot\" --notes \"brouter.de rd5 tiles of $stamp (OpenStreetMap data, ODbL), for the BRouter parity fixtures.\""
