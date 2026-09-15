#!/usr/bin/env bash
set -euo pipefail

# Mirrors the `test`, `app` and `ui` jobs in .github/workflows/ci.yml, in the same order, so a
# gate failure here is the CI failure you would otherwise get a few minutes later.
#
# Ship exports SHIP_REPO, SHIP_DEFAULT_BRANCH, SHIP_BRANCH and SHIP_BASE_SHA before
# calling this. Nothing here scopes itself to the diff: every gate runs every time.

# --frozen-lockfile is the assertion that the lockfile still matches package.json;
# a plain install would quietly fix it and hide the drift until CI.
pnpm install --frozen-lockfile

# biome + both tsc passes.
pnpm check

# The whole suite, both lanes. It includes the check that the app's fixtures are what
# the TypeScript codecs answer today.
pnpm test

# Not redundant with CI: the edge build refuses a bundle over Bunny's 10MB cap
# (packages/edge/scripts/build.ts), so this is the size assertion too.
pnpm build

# The app's Kotlin, on the JVM and as native Linux code: the shared codecs against those
# fixtures, and BRouter against brouter.de on every parity route. The first run downloads
# the 450 MB tile snapshot into ~/.cache/tracks.
(cd app && ./gradlew --quiet :shared:jvmTest :shared:linuxX64Test :brouter:jvmTest :brouter:linuxX64ReleaseTest)

# The app's UI: its logic tests, beside a throwaway local Tracks for the one that uploads a replayed ride (a
# database file made for the run, never production), then the real map drawn in the screenshots container and
# compared with the committed pictures. Podman here, docker in CI; the same image either way.
(cd app && scripts/local-tracks.sh ./gradlew --quiet :ui:jvmTest)
app/desktopApp/screenshots/run.sh
