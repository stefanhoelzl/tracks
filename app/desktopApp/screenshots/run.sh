#!/usr/bin/env bash
# The screenshot tests, as CI runs them: the harness in the screenshots container, drawing the real map on software
# Vulkan from tiles on disk, compared with the pictures in this directory.
#
#     app/desktopApp/screenshots/run.sh            compare every scene
#     app/desktopApp/screenshots/run.sh --update   rewrite the pictures, to be reviewed like code
#     app/desktopApp/screenshots/run.sh --record   fetch fixture files the scenes need and fixture/ lacks
#
# The container has no network unless recording, so a scene that needs a tile nobody committed fails rather than
# quietly asking tiles.versatiles.org — a donation-run server that CI never touches. CONTAINER_ENGINE is podman by
# default; CI uses docker. Failures leave the picture taken and a diff in app/desktopApp/build/screenshots.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/../.." && pwd)
engine=${CONTAINER_ENGINE:-podman}
gradle_home=${GRADLE_USER_HOME:-$HOME/.gradle}

(cd "$app" && ./gradlew --quiet :desktopApp:screenshotClasspath)
java_home=$(cat "$app/desktopApp/build/screenshot-run/java-home.txt")

"$engine" build --quiet --tag tracks-screenshots --file "$here/Containerfile" "$here" >/dev/null

network=none
for arg in "$@"; do [ "$arg" = --record ] && network=host; done

# label=disable: on an SELinux host the mounted checkout is not the container's to read, and relabelling it (:z) would
# change the checkout itself. Docker on CI's Ubuntu accepts the option and has nothing to disable.
exec "$engine" run --rm --network "$network" --security-opt label=disable \
  --volume "$app:$app" --volume "$gradle_home:$gradle_home:ro" --volume "$java_home:$java_home:ro" \
  --workdir "$app" tracks-screenshots desktopApp/screenshots/scene.sh "$@"
