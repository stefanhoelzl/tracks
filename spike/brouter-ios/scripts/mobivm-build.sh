#!/bin/bash
# Candidate B. Compiles BRouter's routing core and the spike runner to bytecode, then has MobiVM's
# ahead-of-time compiler turn it into an xcframework (arm64 simulator slice) that exports the JNI
# invocation API. Downloads MobiVM 2.3.26 from Maven Central into the cache on first use.
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${SPIKE_CACHE:-$HOME/spike-cache}
VERSION=2.3.26
MOBIVM=$CACHE/mobivm
BUILD=$SPIKE/build/mobivm
JAVA17=${JAVA_HOME_17:-$(/usr/libexec/java_home -v 17)}

mkdir -p "$MOBIVM"
M2=https://repo1.maven.org/maven2/com/mobidevelop/robovm
[ -f "$MOBIVM/robovm-dist-compiler-$VERSION.jar" ] ||
  curl -sf -o "$MOBIVM/robovm-dist-compiler-$VERSION.jar" "$M2/robovm-dist-compiler/$VERSION/robovm-dist-compiler-$VERSION.jar"
if [ ! -d "$MOBIVM/robovm-$VERSION" ]; then
  curl -sf "$M2/robovm-dist/$VERSION/robovm-dist-$VERSION-nocompiler.tar.gz" | tar xz -C "$MOBIVM"
fi

ROOTS=()
while IFS= read -r r; do ROOTS+=("$r"); done < <("$SPIKE/scripts/fetch-brouter.sh")

rm -rf "$BUILD/classes" "$BUILD/xcframework" "$BUILD/framework"
mkdir -p "$BUILD/classes"
find "${ROOTS[@]}" -name '*.java' | sort > "$BUILD/sources.txt"

echo "== javac ($(wc -l < "$BUILD/sources.txt") files)"
# Compiled against the JDK's Java 11 API. MobiVM's runtime library is its own (Android libcore
# based) and javac cannot use it as a boot class path at this language level; REPORT.md records the
# static scan of every JDK member the core references against robovm-rt.jar instead.
# -XDstringConcat=inline: javac 9+ compiles "a" + b to an invokedynamic on StringConcatFactory,
# which MobiVM's runtime does not have; inline keeps the StringBuilder chains Java 8 produced.
"$JAVA17/bin/javac" -nowarn --release 11 -XDstringConcat=inline \
  -d "$BUILD/classes" -encoding UTF-8 @"$BUILD/sources.txt" 2>&1 | tee "$BUILD/javac.log"
(cd "$BUILD/classes" && "$JAVA17/bin/jar" cf "$BUILD/brouter.jar" .)

echo "== robovm"
T0=$(date +%s)
(cd "$SPIKE/mobivm" && "$JAVA17/bin/java" -Xmx4g -cp "$MOBIVM/robovm-dist-compiler-$VERSION.jar" \
  org.robovm.compiler.AppCompiler \
  -home "$MOBIVM/robovm-$VERSION" -cache "$MOBIVM/cache" -tmp "$BUILD/tmp" \
  -config robovm.xml -archs arm64-simulator \
  -cp "$BUILD/brouter.jar" -d "$BUILD/xcframework" 2>&1) | tee "$BUILD/robovm.log"
T1=$(date +%s)
echo "robovm: $((T1 - T0)) s"

SLICE=$(find "$BUILD/xcframework" -type d -name BRouterCore.framework -path '*simulator*' | head -1)
mkdir -p "$BUILD/framework"
cp -R "$SLICE" "$BUILD/framework/"
echo "framework: $(du -sk "$BUILD/framework/BRouterCore.framework" | cut -f1) KB"
nm -gU "$BUILD/framework/BRouterCore.framework/BRouterCore" | grep -E ' _JNI_(GetCreatedJavaVMs|CreateJavaVM)$' || echo "JNI invocation API not exported"
