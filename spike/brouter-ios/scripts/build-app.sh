#!/bin/bash
# Builds the harness app for one candidate, for the arm64 iOS Simulator, without an Xcode project:
# clang for the engine shim, swiftc for the harness, a hand-rolled .app bundle, ad-hoc signed.
#
# usage: build-app.sh <stub|j2objc|mobivm>
#
# The candidate's engine must already be built (j2objc-build.sh / mobivm-build.sh). Prints the
# bundle's size breakdown, excluding the rd5 and profiles, which every candidate bundles alike.
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${SPIKE_CACHE:-$HOME/spike-cache}
CAND=$1
BUILD=$SPIKE/build/$CAND
APP=$BUILD/SpikeHarness.app
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
# xcrun otherwise exports the macOS SDK to the tools it runs, and clang warns about the mismatch.
export SDKROOT=$SDK
TARGET=arm64-apple-ios17.0-simulator

rm -rf "$APP" "$BUILD/obj"
mkdir -p "$APP" "$BUILD/obj"

LINK=()
case $CAND in
  stub)
    xcrun clang -target $TARGET -isysroot "$SDK" -O2 -c "$SPIKE/harness/stub/SpikeEngineStub.c" -o "$BUILD/obj/engine.o"
    LINK=("$BUILD/obj/engine.o")
    ;;
  j2objc)
    J2OBJC=$CACHE/j2objc-src/dist
    xcrun clang -target $TARGET -isysroot "$SDK" -O2 -fobjc-arc \
      -I "$BUILD/gen" -I "$J2OBJC/include" \
      -c "$SPIKE/harness/j2objc/SpikeEngineJ2ObjC.m" -o "$BUILD/obj/engine.o"
    if [ "${J2OBJC_LINK:-full}" = full ]; then
      # J2ObjC's documented default: the whole JRE with -ObjC, so classes that are only reached by
      # name (charsets, locale data, security providers) survive the linker.
      JRE=(-ljre_emul -Xlinker -ObjC)
    else
      # 3.1's lean option: the core subset plus the pieces BRouter touches, dead-stripped.
      JRE=(-ljre_core -ljre_util -ljre_security -Xlinker -dead_strip)
    fi
    LINK=("$BUILD/obj/engine.o" "$BUILD/libbrouter.a" -L "$J2OBJC/lib/simulator" "${JRE[@]}"
      -liconv -lz -framework Security -framework Foundation)
    ;;
  mobivm)
    SLICE=$BUILD/framework
    xcrun clang -target $TARGET -isysroot "$SDK" -O2 \
      -I "$JAVA_HOME/include" -I "$JAVA_HOME/include/darwin" \
      -c "$SPIKE/harness/mobivm/SpikeEngineMobiVM.c" -o "$BUILD/obj/engine.o"
    LINK=("$BUILD/obj/engine.o" -F "$SLICE" -framework BRouterCore
      -Xlinker -rpath -Xlinker @executable_path/Frameworks)
    mkdir -p "$APP/Frameworks"
    cp -R "$SLICE/BRouterCore.framework" "$APP/Frameworks/"
    ;;
  *)
    echo "unknown candidate $CAND" >&2
    exit 2
    ;;
esac

xcrun swiftc -target $TARGET -sdk "$SDK" -O \
  -import-objc-header "$SPIKE/harness/SpikeEngine.h" \
  "$SPIKE/harness/Harness.swift" "${LINK[@]}" -o "$APP/SpikeHarness"

cp "$SPIKE/harness/Info.plist" "$APP/Info.plist"
cp "$SPIKE/routes.tsv" "$APP/"
cp -R "$CACHE/brouter/misc/profiles2" "$APP/profiles2"
mkdir -p "$APP/segments"
# A hard link keeps 200 MB out of every build; the simulator install copies it regardless.
ln -f "$CACHE/segments/E10_N45.rd5" "$APP/segments/E10_N45.rd5"

if [ -d "$APP/Frameworks" ]; then
  for f in "$APP"/Frameworks/*.framework; do codesign --force --sign - "$f"; done
fi
codesign --force --sign - "$APP"

echo "== $CAND bundle size (bytes), excluding segments and profiles"
EXE=$(stat -f %z "$APP/SpikeHarness")
FW=0
if [ -d "$APP/Frameworks" ]; then FW=$(find "$APP/Frameworks" -type f -exec stat -f %z {} + | awk '{s+=$1} END {print s+0}'); fi
VARIANT=default
[ "$CAND" = j2objc ] && VARIANT=${J2OBJC_LINK:-full}
echo "{\"candidate\":\"$CAND\",\"variant\":\"$VARIANT\",\"executableBytes\":$EXE,\"frameworksBytes\":$FW,\"totalBytes\":$((EXE + FW))}" |
  tee "$BUILD/size-$VARIANT.json"
