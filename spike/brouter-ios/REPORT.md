# Spike: BRouter's Java routing core on iOS

Can the Tracks iOS companion run the same BRouter engine as the web, offline on the phone, from native
Swift? Two ways of getting Java onto iOS were built and measured in the iOS Simulator: **J2ObjC**
(source translation to Objective-C) and **MobiVM** (ahead-of-time compilation of bytecode, with its own
runtime and GC). There were no pass/fail limits; the numbers below are what the choice is made from.

_Measured 2026-09-14._

## Comparison

Simulator numbers on a GitHub `macos-26` runner (Apple M1 virtual, 3 cores, 7 GB) — one app launch per
route, cold pass. "JVM (M1)" is the same `SpikeRunner` on HotSpot 17 on that runner, for scale.

| | JVM (M1) | MobiVM 2.3.26 | J2ObjC 3.1 (as translated) | J2ObjC + leak patches |
|---|---:|---:|---:|---:|
| **Parity**, 6 routes | reference | identical ¹ | identical ¹ | <!-- E:parity --> |
| **r1 27 km**, cold / warm | 1.8 s / 0.8 s ² | 2.0 s / 1.8 s | 4.6 s / 4.0 s | <!-- E:r1 --> |
| **r2 176 km**, cold / warm | 9.3 s | 10.9 s / 12.5 s | 42.2 s / 38.6 s | <!-- E:r2 --> |
| r6 306 km, cold | 16.0 s | 22.1 s | 80.8 s | — |
| **Peak footprint** r1 / r2 | — | 65 / 107 MB | 427 MB / **3.2 GB** | <!-- E:peak --> |
| Peak footprint r6 | — | 118 MB | **5.9 GB** | — |
| Footprint, runtime up, no route | — | 12 MB | 16 MB | — |
| **20× r1**: settled after run 1 → 20 | heap 5 → 5 MB | 64 → 109 MB (flat from run 8) | 145 → 669 MB (+27.6 MB every run) | <!-- E:rep1 --> |
| **20× r2**: settled after run 1 → 20 | — | 76 → 105 MB (76–127, no trend) | 966 MB → 3.7 GB (+144 MB every run) | <!-- E:rep2 --> |
| **App size increase** over an empty app | — | +7.6 MB (framework) | +42.9 MB (`-ObjC` full JRE) <!-- E:lean --> | same |
| Source changes | — | 1 patch (no reflection) | 1 patch | + 2 patches |
| Toolchain | — | 2 downloads, 1 `java` command | source build of J2ObjC, 2 workarounds | |

¹ Byte-identical GeoJSON except `"creator"` (`BRouter-0.0` / `BRouter-null`: the version string comes
from jar metadata). Checked by `scripts/compare.py` for geometry, elevation and all numeric properties,
and line by line.
² JVM warm = the 20-repeat median (JIT warmed up).

Footprint is `phys_footprint`, sampled every 2 ms, as iOS jetsam counts it. The simulator enforces no
limit; a 4 GB iPhone 12 kills an app at about 2 GB, a 6 GB device at about 3 GB.

## Parity

Every candidate output was compared with `fixtures/jvm`, which is itself byte-identical to brouter.de:

| route | points | MobiVM | J2ObjC |
|---|---:|---|---|
| r1 Munich → Starnberg | 653 | identical | identical |
| r2 Munich → Innsbruck | 4805 | identical | identical |
| r3 Garmisch → Innsbruck | 2077 | identical | identical |
| r4 Salzburg → Hallein | 282 | identical | identical |
| r5 Rosenheim → Prien → Traunstein | 1691 | identical | identical |
| r6 Munich → Bolzano | 9396 | identical | identical |

Identical means: same coordinates and elevations in the same order, and equal `track-length`,
`filtered ascend`, `plain-ascend`, `total-time`, `total-energy` and `cost`. Neither translation nor AOT
compilation changed a single number — the integer-heavy core has no floating-point formatting on the
hot path that differs between runtimes.

## Memory

**MobiVM** behaves like a JVM with a collector: footprint rises during a route, stays at what the GC
heap grew to, and repeated routes reuse it. Over 20 repeats of r1 the settled footprint climbs to
~105 MB by run 8 and then stays there; over 20 of r2 it moves between 76 and 127 MB with no trend.
A 60-run r1 series held at 104–110 MB until run 50, then settled higher for the last ten runs
(117–146 MB) — no leak of J2ObjC's kind, but not a perfectly flat line either. Nothing was needed to
stop leaks.

**J2ObjC** as translated leaks every route's whole road graph and peaks far above what a phone allows:

- *The leak.* The settled footprint grows by the same amount after every run — 27.6 MB per r1,
  ~144 MB per r2 — and never comes back. `cycle_finder` explains it: `OsmNode`, `OsmLink` and `OsmPath`
  (through `OsmLinkHolder`) point at each other, and so do `BExpressionContext` and
  `BExpressionMetaData`. BRouter's graph is cyclic by design (nodes know their links, links know both
  nodes and the next link of each), and when `RoutingEngine` drops its `NodesCache` a tracing GC frees
  it, reference counting never does.
- *The peak.* r2 peaks at 3.2 GB and settles at 966 MB. The difference is garbage that only reference
  counting's timing keeps alive (autoreleased temporaries live until the routing thread's pool drains)
  plus the leaked graph itself. 3.2 GB for a 176 km route would be killed on every current iPhone.

`cycle_finder` reported 59 cycles, 34 of them through BRouter types (18 types; `RoutingEngine` 28,
mostly via `Thread` and JRE internals). It resolved JRE types against the host JDK despite
`-Xbootclasspath`, so some of those paths run through JDK-only classes and overstate the count; the ones
that matter are the graph cycles above, and the measurement confirms them.

<!-- EXPERIMENTS -->

## Open risks

What the spike did not or could not measure:

- **Real devices.** Everything ran on the simulator (arm64 code on a virtual M1). Device slices
  (`iphone64` for J2ObjC, `arm64` for MobiVM) were not built, nothing was signed, and neither jetsam's
  kill limit nor thermal throttling applied. A-series performance cores are faster than this runner's
  virtual cores, so times should improve on a recent phone, but that is unmeasured, and so is battery.
- **Memory headroom on device.** MobiVM's ~110–150 MB is comfortable against a ~2 GB limit, but the
  60-run series ended above its plateau; a long session (hundreds of re-plans) and memory warnings were
  not tested. `memoryclass` (128, as brouter.de) was not varied; it bounds `NodesCache` and is the knob
  for trading memory against speed on longer routes.
- **Garbage collection pauses.** MobiVM uses the conservative Boehm GC. Individual pause lengths were not
  measured; they matter if routing ever shares a thread with UI or navigation updates.
- **Larger areas.** One 5°×5° tile and routes inside it. Routes crossing tile edges, several tiles open
  at once, and rd5 storage/downloads (a tile is ~200 MB) were not part of this.
- **Other BRouter paths.** Only `trekking`, `alternativeidx=0`, no nogos, no round trips. Car profiles
  take the `---model:` path the patch rewrites; nogo polygons, voice hints and other formats were not
  exercised. `Locale$Builder` is a phantom class in MobiVM's runtime: a code path that reaches it would
  fail at run time.
- **Upgrades.** brouter.de runs 1.7.10 today. Each BRouter release has to be re-translated or re-compiled
  and re-verified against the server; `scripts/compare.py` and the fixtures are the regression test,
  but the J2ObjC leak patches touch core classes and would need rebasing.
- **Toolchain continuity.**
  - MobiVM: 46 commits in the last 12 months, 37 from one maintainer (dkimitsa); releases 2.3.24
    (Nov 2025), 2.3.25 (Jun 2026), 2.3.26 (Aug 2026). The bus factor is one. It follows new Xcode
    versions after the fact; a new Xcode or iOS SDK that breaks it blocks releases until it is fixed.
  - J2ObjC: 216 commits in 12 months from a Google team, but the last tag is 3.1 (Aug 2025), there are no
    binaries, the public make build ships a broken `cycle_finder`, and Xcode 26 already needs a warning
    suppressed. Google builds it with Bazel internally; the public build is secondary.
- **App Store and platform.** Neither build was submitted. MobiVM apps (mostly libGDX games) ship on the
  store today; an embedded AOT runtime in a `.framework` next to a Swift app is less common. Neither
  candidate targets watchOS the same way (J2ObjC can build `watchos64`; MobiVM cannot), which matters if a
  Watch re-plan is ever wanted — Cartograph already does that.
- **Licensing.** MobiVM's runtime and VM, which ship inside the app, are Apache 2.0 (the compiler is only
  a build tool). J2ObjC is Apache 2.0; its JRE emulation includes OpenJDK/Android libcore code under their
  own licenses. BRouter is MIT. No blocker found; not reviewed by counsel.

## Setup

| | |
|---|---|
| BRouter | v1.7.10 (tag), the version brouter.de reports in `creator`; 5 core modules, 102 files incl. the spike runner |
| Data | `E10_N45.rd5` (199 MB, sha256 `347600a6…cae90`, downloaded 2026-09-14), `misc/profiles2` from the tag, profile `trekking` |
| Request | what `packages/routing` sends: `lonlats`, `profile=trekking`, `alternativeidx=0`, `format=geojson`; `memoryclass=128` as `RouteServer` |
| Linux baseline | OpenJDK 17.0.20, x86_64, 16 threads |
| Simulator | GitHub `macos-26` runner: Apple M1 (Virtual), 3 cores, 7 GB RAM; macOS 26.6.2, Xcode 26.6, iPhone 17 Pro simulator |
| J2ObjC | 3.1, built from source (no binaries are published for 3.x) |
| MobiVM | 2.3.26 from Maven Central (`robovm-dist` + `robovm-dist-compiler`) |

Reference routes (`routes.tsv`), all inside the one tile:

| id | route | length | filtered ascend |
|---|---|---:|---:|
| r1 | Munich → Starnberg ("20 km") | 26.9 km | 142 m |
| r2 | Munich → Innsbruck ("150 km") | 176.2 km | 312 m |
| r3 | Garmisch → Innsbruck | 61.7 km | 664 m |
| r4 | Salzburg → Hallein | 15.0 km | 24 m |
| r5 | Rosenheim → Prien → Traunstein (via) | 51.8 km | 392 m |
| r6 | Munich → Bolzano (stress) | 305.8 km | 1705 m |

## Baseline: the JVM matches brouter.de byte for byte

`JvmMain` routes every line of `routes.tsv` through `SpikeRunner`, the same entry point the iOS
harness calls, and writes the GeoJSON. All six outputs are **byte-identical** to brouter.de's
responses for the same requests (`fixtures/brouter.de` vs `fixtures/jvm`): same points, elevations,
`track-length`, `filtered ascend`, `plain-ascend`, `total-time`, `total-energy`, `cost`.

JVM timings on Linux (one process, cold first): r1 1658 ms, r2 6594 ms, r3 628 ms, r4 169 ms,
r5 361 ms, r6 12198 ms; r1 repeated 20× at ~600 ms with heap-in-use flat at 8 MB after GC. Peak RSS
of the whole JVM process 497 MB (default heap sizing; not comparable to an iOS footprint).

## How Cartograph Maps 3 does it

Cartograph (developer Harald Meyer) does not say how, and nothing public does: no BRouter issue, repo or
forum post describes an iOS port. What its own pages and App Store listing do say:

- "native BRouter support on all platforms": iOS, iPadOS, macOS (`.pkg`), Windows 10 (`.exe`), Android
  ([how-to](https://www.cartograph.eu/v3/how-to-use-brouter-offline-router-on-ios-macos-windows-android/),
  [download](https://www.cartograph.eu/v3/download/)).
- 3.9.1: "BRouter implementation (faster, better memory usage)" and "BRouter updated to 1.7.9"
  ([App Store](https://apps.apple.com/us/app/cartograph-maps-3/id1588186796)). It tracks upstream
  releases.
- 4.0.3 (August 2026): "offline BRouter routing directly on smart watches" — Apple Watch included.
- The iOS app is 137 MB and needs iOS 16.2.

Inference, not fact: routing on watchOS rules out anything that ships a JVM or MobiVM's runtime
(MobiVM has no watchOS target), and following upstream point releases argues against a hand rewrite.
That leaves a mechanical translation — J2ObjC supports watchOS, as would a transpile to C++ or C# —
shared by all five platforms. Asking the developer directly (support contact on cartograph.eu) is still
open; nobody has been contacted from this spike.

## How the harness works

One Java entry point, one C entry point, one Swift app:

- `java/src/spike/SpikeRunner.java` builds the `RoutingContext` exactly as `RouteServer` does for the
  web app's request and returns `FormatJson` output. `routeOnBigStack` runs it on a Java thread with a
  16 MB stack (iOS secondary threads default to 512 KB).
- `harness/SpikeEngine.h` is the C API every candidate implements: `spike_init`, `spike_route`,
  `spike_free`, `spike_gc`. J2ObjC: an ARC Objective-C shim calling the translated
  `SpikeSpikeRunner`. MobiVM: plain JNI (`JNI_GetCreatedJavaVMs`, `AttachCurrentThread`,
  `CallStaticObjectMethod`) into the VM the framework starts at load time — no cocoatouch bindings.
  Stub: returns an error, and its app is the size baseline.
- `harness/Harness.swift` is a UIKit app with no UI. `SPIKE_MODE` picks the run; each route is timed
  and a sampler thread reads `task_vm_info.phys_footprint` every 2 ms for the peak. It prints one
  `SPIKE {json}` line per run and writes GeoJSON to `Documents/out`.
- No Xcode project: `scripts/build-app.sh` compiles with `clang`/`swiftc`, assembles the `.app`,
  bundles `routes.tsv`, `profiles2` and the rd5, and signs ad hoc. `scripts/run-sim.sh` installs and
  launches with `simctl launch --console-pty` and collects the output.

Each route is measured in its own app launch (cold, then warm in the same process), so one route's
caches never flatter the next.

## Build recipes

Both run on the macOS runner (`.ssh-runner.yml` profile `macos`: JDK 17 + 21, `~/spike-cache` kept
between sessions). `scripts/fetch-brouter.sh` checks out v1.7.10 and applies `patches/`.

### Candidate A: J2ObjC 3.1

1. **Build J2ObjC** (once, cached). No binary release exists for 3.x.
   ```sh
   git clone --depth 1 --branch 3.1 https://github.com/google/j2objc.git j2objc-src && cd j2objc-src
   export JAVA_HOME=$(/usr/libexec/java_home -v 21)
   make -j3 translator_dist cycle_finder_dist                      # 31 s
   make -j3 J2OBJC_ARCHS=simulator64 \
     WARNINGS=-Wno-implicit-const-int-float-conversion jre_emul_dist  # ~2 min for one arch
   ```
   `simulator64` is the arm64 simulator slice; a device build adds `iphone64`, which roughly doubles
   the runtime build.
2. **Translate, compile, archive**: `scripts/j2objc-build.sh` — `j2objc -d gen -sourcepath …` over
   the 102 files (4 s), `clang -fno-objc-arc -O2` per file for `arm64-apple-ios17.0-simulator` (8 s),
   `libtool -static` → `libbrouter.a` (2.5 MB).
3. **Link**: `scripts/build-app.sh j2objc` — `libbrouter.a` + `-ljre_emul -ObjC -liconv -lz
   -framework Security` (J2ObjC's documented default), or `J2OBJC_LINK=lean` for
   `-ljre_core -ljre_util -ljre_security -dead_strip` without `-ObjC`.

Source changes: `patches/0001-path-model-without-reflection.patch` only — `RoutingContext.setModel`
names BRouter's three path models instead of `Class.forName`, since the linker strips classes nothing
references. `trekking` never takes that path (no `---model:` line); car profiles do. J2ObjC rejected
nothing else, including `StackSampler`, which cannot be left out (`RoutingEngine` imports it).

Friction met:
- **No binaries for 3.x**: the toolchain is a source build (`make`, JDK 21, Xcode).
- **Xcode 26 breaks the runtime build**: clang's `-Wimplicit-const-int-float-conversion` fires in
  J2ObjC's own `Hashtable.m` under `-Werror`; `WARNINGS=-Wno-…` gets past it.
- **`cycle_finder` is broken in the public build**: `dist/lib/cycle_finder.jar` contains only a
  manifest (so do `cycle_finder.jar-combined` and the build's class dir). It had to be compiled from
  `cycle_finder/src` against the translator's classes, run with the `--add-exports` flags the `j2objc`
  launcher passes, pointed at `jre_emul.jar` and J2ObjC's own suppress list, and given the file list
  inline (it takes no `@argfile`).
- `GeoJSON "creator"` reads `BRouter-null`: `OsmTrack.version` comes from jar metadata.

### Candidate B: MobiVM 2.3.26

1. **Toolchain**: `scripts/mobivm-build.sh` downloads `robovm-dist-2.3.26-nocompiler.tar.gz` (44 MB)
   and `robovm-dist-compiler-2.3.26.jar` (59 MB) from Maven Central. No Maven or Gradle project, no
   IDE plugin.
2. **Bytecode**: `javac --release 11 -XDstringConcat=inline` over the same 102 files → `brouter.jar`.
3. **AOT to xcframework**:
   ```sh
   java -cp robovm-dist-compiler-2.3.26.jar org.robovm.compiler.AppCompiler \
     -home robovm-2.3.26 -config mobivm/robovm.xml -archs arm64-simulator \
     -cp brouter.jar -d build/mobivm/xcframework
   ```
   `robovm.xml`: `target xcframework`, `os ios`, an `Info.plist` (required for frameworks), and
   `forceLinkClasses` for `spike.SpikeRunner` and `btools.**` (nothing references the entry point; the
   Swift side finds it by name). 30 s once the runtime is in MobiVM's cache.
4. **Link**: `scripts/build-app.sh mobivm` — `-framework BRouterCore`, embedded in
   `SpikeHarness.app/Frameworks` with `@executable_path/Frameworks` as rpath; the shim includes the
   JDK's `jni.h`.

Source changes: the same patch. A static scan of every JDK class, method and field the compiled core
references (286 member references across 73 classes) against `robovm-rt.jar` found nothing missing.

Friction met:
- **`<arch>` in `robovm.xml` was ignored** ("No archs specified in config"), and `<archs>` is rejected
  outright; `-archs arm64-simulator` on the command line works.
- **Java 9+ string concatenation**: javac's `invokedynamic` to `StringConcatFactory` does not exist in
  MobiVM's runtime; the build failed with an unhelpful `Cannot run program ""` until
  `-XDstringConcat=inline`.
- Remaining compiler warnings: `java.util.Locale$Builder` and `org.robovm.objc.ObjCObject` are phantom
  classes (not reached by the routing path in these runs).
- `GeoJSON "creator"` reads `BRouter-0.0`, for the same reason as J2ObjC.
