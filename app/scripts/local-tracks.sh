#!/usr/bin/env bash
# Runs a command beside a throwaway Tracks, for the test that uploads to a real one (LocalServerTest).
#
#     app/scripts/local-tracks.sh ./gradlew :ui:jvmTest
#
# The server is the dev server — the real API in Vite's module runner — against a database file made for this run and
# deleted after it: nothing it writes outlives the command, and nothing is written to production. Migration 0004 seeds
# the account, and the dev server claims it with the password `password`, which the test signs in with.
#
# On 127.0.0.1 rather than Vite's default `localhost`, which on some machines is IPv6 loopback only and on others is
# not. Needs `pnpm install`. CI's `ui` job and .ship/gates.sh both run the UI tests through this.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
port=${TRACKS_E2E_PORT:-5199}
url="http://127.0.0.1:$port"
work=$(mktemp -d)

# Its own process group, so stopping it stops Vite and not only the pnpm in front of it.
TRACKS_DB_URL="file:$work/tracks.db" setsid pnpm --dir "$repo" --filter @tracks/web dev --host 127.0.0.1 --port "$port" --strictPort \
  >"$work/server.log" 2>&1 &
server=$!

stop() {
  kill -- -"$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
  rm -rf "$work"
}
trap stop EXIT

answering() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$url/api/session")" != 000 ]; }
for _ in $(seq 120); do
  answering && break
  kill -0 "$server" 2>/dev/null || break
  sleep 0.5
done
if ! answering; then
  cat "$work/server.log" >&2
  echo "local-tracks: no Tracks answering on $url" >&2
  exit 1
fi

TRACKS_E2E_SERVER="$url" "$@"
