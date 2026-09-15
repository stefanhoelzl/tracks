#!/usr/bin/env bash
set -euo pipefail

# Mirrors the `test` and `app` jobs in .github/workflows/ci.yml, in the same order, so a
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

# The app's shared Kotlin, on the JVM and as native Linux code: that it still agrees
# with those fixtures.
(cd app && ./gradlew --quiet :shared:jvmTest :shared:linuxX64Test)
