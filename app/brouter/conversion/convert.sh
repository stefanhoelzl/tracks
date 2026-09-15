#!/bin/bash
# Converts BRouter's routing core from Java to Kotlin with IntelliJ's own J2K (K2 mode), headless, in a
# container, one file at a time in dependency order. Then `replay.sh` applies the fix passes.
#
#   ./convert.sh                          BRouter v1.7.10, IntelliJ IDEA 2026.2.2 (open-source build)
#   BROUTER_REF=v1.7.11 ./convert.sh      the next release
#
# Steps: fetch BRouter at BROUTER_REF and apply patches/java/*.patch; download the IDE and check its sha256;
# build the J2K plugin against that IDE; build the container image; stage the five core modules as a
# scratch project; run the `j2k` app starter; copy the resulting .kt files, untouched, to $CACHE/raw-perfile.
#
# The output depends on the IDE build, so IDEA_VERSION is pinned and upgraded as a step of its own.
# Per-file mode is not a preference: converting all files in one call loses the contracts between them
# (1,202 compile errors against 399). The IDE is the Apache-2.0 open-source build (docs/j2k-licensing.md);
# IDEA_DISTRIBUTION=unified uses JetBrains' unified download instead.
#
# Needs podman, ~7 GB of disk in the cache and ~5 GB of free memory (the container is capped there).
#
# Env: BROUTER_REF (v1.7.10), IDEA_VERSION (2026.2.2), IDEA_DISTRIBUTION (open-source | unified),
#      TRACKS_CACHE (~/.cache/tracks), HEAVY_LOCK (a flock file serialising heavy jobs, optional)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)
CACHE=${TRACKS_CACHE:-$HOME/.cache/tracks}/j2k
BROUTER_REF=${BROUTER_REF:-v1.7.10}
IDEA_VERSION=${IDEA_VERSION:-2026.2.2}
IDEA_DISTRIBUTION=${IDEA_DISTRIBUTION:-open-source}
MODULES="brouter-codec brouter-core brouter-expressions brouter-mapaccess brouter-util"
lock() { if [ -n "${HEAVY_LOCK:-}" ]; then flock "$HEAVY_LOCK" "$@"; else "$@"; fi; }

mkdir -p "$CACHE"

# 1. BRouter at the requested ref, with our Java-side patches.
BR=$CACHE/brouter-$BROUTER_REF
if [ ! -d "$BR" ]; then
  git clone -q --depth 1 --branch "$BROUTER_REF" https://github.com/abrensch/brouter.git "$BR"
  for p in "$HERE"/patches/java/*.patch; do git -C "$BR" apply "$p"; done
fi

# 2. The IDE, checked, and extracted (the plugin compiles against the extracted copy).
case "$IDEA_DISTRIBUTION" in
  open-source)
    TGZ=$CACHE/idea-oss-$IDEA_VERSION.tar.gz
    URL=https://github.com/JetBrains/intellij-community/releases/download/idea%2F$IDEA_VERSION/idea-$IDEA_VERSION.tar.gz
    # Pinned per version: GitHub's asset digest for the release.
    case "$IDEA_VERSION" in
      2026.2.2) WANT=6612d47ac536fc38683cd0714babf14b660ab157a4fe1af1e9bf9683f635cbed ;;
      *) echo "no pinned sha256 for the open-source build of $IDEA_VERSION: add it here" >&2; exit 1 ;;
    esac
    ;;
  unified)
    TGZ=$CACHE/idea-$IDEA_VERSION.tar.gz
    URL=https://download.jetbrains.com/idea/idea-$IDEA_VERSION.tar.gz
    WANT=$(curl -fsL "$URL.sha256" | awk '{print $1}')
    ;;
  *) echo "IDEA_DISTRIBUTION must be open-source or unified" >&2; exit 1 ;;
esac
if [ ! -f "$TGZ" ]; then
  curl -fL -o "$TGZ.part" "$URL"
  mv "$TGZ.part" "$TGZ"
fi
echo "$WANT  $TGZ" | sha256sum -c -
IDEA=$CACHE/idea-$IDEA_DISTRIBUTION-$IDEA_VERSION
if [ ! -f "$IDEA/product-info.json" ]; then
  rm -rf "$IDEA" && mkdir -p "$IDEA"
  tar -xzf "$TGZ" -C "$IDEA" --strip-components=1
fi

# 3. The plugin: one ApplicationStarter, built with the app's Gradle wrapper against that IDE.
(cd "$HERE/j2k/plugin" && lock "$APP/gradlew" --no-daemon -q -PideaHome="$IDEA" buildPlugin)
PLUGINS=$CACHE/plugins
rm -rf "$PLUGINS" && mkdir -p "$PLUGINS"
unzip -q -o "$HERE"/j2k/plugin/build/distributions/j2k-headless-*.zip -d "$PLUGINS"

# 4. The image. The tarball comes from a small build context of its own, so it is not sent twice.
IMAGE=localhost/tracks-j2k:$IDEA_DISTRIBUTION-$IDEA_VERSION
if ! podman image exists "$IMAGE"; then
  CTX=$CACHE/image-context
  rm -rf "$CTX" && mkdir -p "$CTX"
  ln -f "$TGZ" "$CTX/idea.tar.gz" 2>/dev/null || cp "$TGZ" "$CTX/idea.tar.gz"
  cp "$HERE"/j2k/Containerfile "$HERE"/j2k/idea.properties "$HERE"/j2k/idea.vmoptions "$CTX/"
  podman build -t "$IMAGE" "$CTX"
fi

# 5. A scratch project: the five modules' Java sources, one source root each.
WORK=$CACHE/work
rm -rf "$WORK" && mkdir -p "$WORK/project"
for m in $MODULES; do
  mkdir -p "$WORK/project/$m"
  cp -r "$BR/$m/src/main/java" "$WORK/project/$m/java"
done

# 6. Convert.
start=$(date +%s)
lock podman run --rm --memory=5g --userns=keep-id -e J2K_MODE=perfile \
  -v "$WORK:/work:Z" -v "$PLUGINS:/opt/j2k/plugins:ro,Z" \
  "$IMAGE" j2k /work/project /work/report.json $MODULES \
  2>&1 | tee "$WORK/idea-stdout.log"
echo "conversion wall time: $(( $(date +%s) - start )) s" | tee -a "$WORK/idea-stdout.log"

# 7. The raw output, untouched. A module that still holds Java did not convert completely.
OUT=$CACHE/raw-perfile
rm -rf "$OUT" && mkdir -p "$OUT"
for m in $MODULES; do
  mkdir -p "$OUT/$m"
  (cd "$WORK/project/$m/java" && find . -name '*.kt' | cpio -pdm --quiet "$OUT/$m")
  left=$(cd "$WORK/project/$m/java" && find . -name '*.java' | sort)
  if [ -n "$left" ]; then
    echo "still Java in $m:" >&2
    echo "$left" >&2
    exit 1
  fi
done
cp "$WORK/report.json" "$OUT/"
echo "J2K output in $OUT; now ./replay.sh"
