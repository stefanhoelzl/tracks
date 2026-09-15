#!/usr/bin/env bash
# Inside the screenshots container, from app/: an X server, Mesa's software renderers, and the scenes.
set -euo pipefail

Xvfb :99 -screen 0 1280x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 100); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
export DISPLAY=:99

# lavapipe, Mesa's software Vulkan. Mesa 25 names its ICD lvp_icd.json, earlier ones lvp_icd.x86_64.json.
VK_ICD_FILENAMES=$(ls /usr/share/vulkan/icd.d/lvp_icd*.json | head -1)
export VK_ICD_FILENAMES
export LIBGL_ALWAYS_SOFTWARE=1

# Skiko blocks any OpenGL renderer whose name starts with "llvmpipe" and falls back to drawing in software, and the
# map refuses to render into that. Mesa's force_gl_renderer renames what the driver reports; the driver is still
# llvmpipe. This is a workaround against a blocklist: the day Skiko changes it, the scenes fail with a blank map.
export force_gl_renderer=softgl-llvmpipe

run=desktopApp/build/screenshot-run
exec "$(cat $run/java-home.txt)/bin/java" -Xmx1g --enable-native-access=ALL-UNNAMED \
  -Dskiko.data.path=/tmp/skiko -cp "$(cat $run/classpath.txt)" net.stho.tracks.desktop.ScreenshotsKt "$@"
