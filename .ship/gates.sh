#!/usr/bin/env bash
set -euo pipefail

# Mirrors the `test` job in .github/workflows/ci.yml, in the same order, so a gate
# failure here is the CI failure you would otherwise get a minute later.
#
# Ship exports SHIP_REPO, SHIP_DEFAULT_BRANCH, SHIP_BRANCH and SHIP_BASE_SHA before
# calling this; a future gate that only needs the diff can scope itself with
# `git diff --name-only "$SHIP_BASE_SHA"..HEAD`. Nothing here needs to — the suite
# is under a minute whole.

# --frozen-lockfile is the assertion that the lockfile still matches package.json;
# a plain install would quietly fix it and hide the drift until CI.
pnpm install --frozen-lockfile

# biome + both tsc passes.
pnpm check

# The whole suite, both lanes.
pnpm test

# Not redundant with CI: the edge build refuses a bundle over Bunny's 10MB cap
# (packages/edge/scripts/build.ts), so this is the size assertion too.
pnpm build
