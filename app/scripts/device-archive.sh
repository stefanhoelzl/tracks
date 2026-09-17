#!/usr/bin/env bash
# Archives the iOS app for a real device, unsigned. The ios-device skill's `build` step runs this on a macOS
# runner, then signs the archive on Linux and installs it over USB.
#
#     app/scripts/device-archive.sh
#
# Why this is a script and not a plain xcodebuild line: app/gradle.properties caps the Gradle and Kotlin
# daemons at 2g, because the dev machine runs several workspaces at once and an uncapped build once got a
# process OOM-killed there. A device archive is Release, and Release links the Kotlin framework with
# devirtualization/LTO, whose peak heap is well past 2g — under the cap it dies with
#
#     error: Compilation failed: Java heap space
#     error: java.lang.OutOfMemoryError: Java heap space
#         at org.jetbrains.kotlin.backend.konan.optimizations.DevirtualizationAnalysis...
#
# CI never sees this: its `ios` job builds Debug for the simulator, and Debug does no such link.
#
# The host that archives for a device is a build runner with RAM to spare, not the dev machine, so the cap is
# lifted here alone — in the Gradle user home, which outranks the project's gradle.properties, and only on the
# host this runs on. The repo's cap is untouched, and a Linux build still gets its 2g.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)

# Must stay in step with `archive:` in .ios-device.yml, which is where the skill looks for the result.
archive=$repo/artifacts/Tracks.xcarchive

heap=${TRACKS_DEVICE_ARCHIVE_HEAP:-5g}
gradle_home=${GRADLE_USER_HOME:-$HOME/.gradle}
props=$gradle_home/gradle.properties

# Rewritten, not appended: a session that archives twice would otherwise stack duplicate keys, and the last
# one wins silently.
mkdir -p "$gradle_home"
[ -f "$props" ] || : > "$props"
awk '/^# >>> tracks device-archive$/{skip=1} !skip{print} /^# <<< tracks device-archive$/{skip=0}' \
  "$props" > "$props.tmp"
cat >> "$props.tmp" <<EOF
# >>> tracks device-archive
# Lifts app/gradle.properties' 2g cap for this build host only; see app/scripts/device-archive.sh.
org.gradle.jvmargs=-Xmx$heap -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx$heap
kotlin.native.jvmArgs=-Xmx$heap
# <<< tracks device-archive
EOF
mv "$props.tmp" "$props"

exec xcodebuild \
  -project "$repo/app/iosApp/iosApp.xcodeproj" \
  -scheme iosApp \
  -configuration Release \
  -destination generic/platform=iOS \
  -archivePath "$archive" \
  CODE_SIGNING_ALLOWED=NO \
  archive
