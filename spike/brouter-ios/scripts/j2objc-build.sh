#!/bin/bash
# Candidate A. Translates BRouter's routing core and the spike runner with J2ObjC, compiles the
# Objective-C for the arm64 iOS Simulator into libbrouter.a, and runs cycle_finder over the same
# sources. Expects J2ObjC's dist in $CACHE/j2objc-src/dist (see REPORT.md for building it).
set -euo pipefail

SPIKE=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${SPIKE_CACHE:-$HOME/spike-cache}
J2OBJC=$CACHE/j2objc-src/dist
BUILD=$SPIKE/build/j2objc
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
TARGET=arm64-apple-ios17.0-simulator
export JAVA_HOME=${JAVA_HOME_21:-$(/usr/libexec/java_home -v 21)}

ROOTS=()
while IFS= read -r r; do ROOTS+=("$r"); done < <("$SPIKE/scripts/fetch-brouter.sh")
SOURCEPATH=$(IFS=:; echo "${ROOTS[*]}")

rm -rf "$BUILD/gen" "$BUILD/objs" "$BUILD/libbrouter.a"
mkdir -p "$BUILD/gen" "$BUILD/objs"
find "${ROOTS[@]}" -name '*.java' | sort > "$BUILD/sources.txt"
echo "== $(wc -l < "$BUILD/sources.txt") Java files"

echo "== translate"
T0=$(date +%s)
"$J2OBJC/j2objc" -d "$BUILD/gen" -sourcepath "$SOURCEPATH" -encoding UTF-8 @"$BUILD/sources.txt" 2>&1 | tee "$BUILD/translate.log"
T1=$(date +%s)
echo "translate: $((T1 - T0)) s, $(find "$BUILD/gen" -name '*.m' | wc -l) .m files"

echo "== compile"
# J2ObjC emits manual-reference-counting code, so no -fobjc-arc here. One clang per file, as many
# at once as there are cores; macOS xargs caps -I commands at 255 bytes, hence the helper.
cat > "$BUILD/compile-one.sh" <<EOF
#!/bin/sh
o="$BUILD/objs/\$(echo "\$1" | sed "s|$BUILD/gen/||; s|/|_|g; s|\\.m\$|.o|")"
exec xcrun --sdk iphonesimulator clang -target $TARGET -isysroot "$SDK" -O2 -fno-objc-arc \\
  -I "$BUILD/gen" -I "$J2OBJC/include" -c "\$1" -o "\$o"
EOF
chmod +x "$BUILD/compile-one.sh"
find "$BUILD/gen" -name '*.m' | sort | xargs -P "$(sysctl -n hw.ncpu)" -n 1 "$BUILD/compile-one.sh" 2>&1 | tee "$BUILD/compile.log"
xcrun libtool -static -no_warning_for_no_symbols -o "$BUILD/libbrouter.a" "$BUILD"/objs/*.o
T2=$(date +%s)
echo "compile: $((T2 - T1)) s, libbrouter.a $(stat -f %z "$BUILD/libbrouter.a") bytes"

echo "== cycle_finder"
# 3.1's public make build ships dist/lib/cycle_finder.jar with nothing but a manifest, so compile
# the tool from its sources against the translator's classes. It takes no @argfile either.
SRC=$CACHE/j2objc-src
CF=$CACHE/cycle_finder-classes
CF_DEPS="$SRC/translator/build_result/classes:$(ls "$SRC"/java_deps/build_result/*.jar | grep -v sources | paste -sd: -):$J2OBJC/lib/j2objc_annotations.jar:$J2OBJC/lib/jsr305-3.0.0.jar"
if [ ! -f "$CF/com/google/devtools/cyclefinder/CycleFinder.class" ]; then
  mkdir -p "$CF"
  "$JAVA_HOME/bin/javac" -nowarn -d "$CF" -cp "$CF_DEPS" $(find "$SRC/cycle_finder/src/main/java" -name '*.java')
  cp -R "$SRC/cycle_finder/src/main/resources/." "$CF/"
fi
# The parser reaches into jdk.compiler internals; borrow the module exports the j2objc launcher passes.
CF_FLAGS=$(grep -oE '"--add-(exports|opens)" "[^"]+"' "$J2OBJC/j2objc" | tr -d '"' | sed 's/ /=/')
# Resolve JRE types against J2ObjC's emulated JRE (what actually ships), not the host JDK, and apply
# the suppress list J2ObjC maintains for its own runtime's known cycles.
"$JAVA_HOME/bin/java" -Xmx2g $CF_FLAGS -cp "$CF:$CF_DEPS" com.google.devtools.cyclefinder.CycleFinder \
  -Xbootclasspath:"$J2OBJC/lib/jre_emul.jar" --suppress-list "$SRC/jre_emul/cycle_suppress_list.txt" \
  -sourcepath "$SOURCEPATH" -encoding UTF-8 $(cat "$BUILD/sources.txt") > "$BUILD/cycle_finder.txt" 2>&1 || true
python3 "$SPIKE/scripts/cycles.py" "$BUILD/cycle_finder.txt" | tee "$BUILD/cycles-summary.txt" | head -3
