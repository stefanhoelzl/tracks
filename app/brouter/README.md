# BRouter, in Kotlin

The phone routes with the router the web routes with: BRouter v1.7.10, on brouter.de's own `rd5` tiles and
profiles. This module is BRouter's routing core, converted from Java by IntelliJ's J2K and a set of scripted
fix passes, and gated on reproducing brouter.de's answers byte for byte.

| path | what | who writes it |
|---|---|---|
| `src/commonMain/kotlin/btools/{codec,expressions,mapaccess,router,util}` | the converted core | `conversion/replay.sh`, never by hand |
| `src/commonMain/kotlin/btools/kmp` | stand-ins for the Java APIs the core uses (`java.io` over Okio, `java.text`, parts of `java.util`), tested against the JDK in `jvmTest` | by hand |
| `src/commonMain/kotlin/net/stho/tracks/brouter` | `BRouter.route`, the app's way in | by hand |
| `profiles/` | brouter.de's `.brf` files for the app's five profiles, and `lookups.dat` | copied from brouter.de |
| `parity/` | the routes, brouter.de's answers, the tile snapshot they belong to | `parity/fetch.sh` |
| `conversion/` | J2K in a container, the fix passes, the replay | by hand |

## A new BRouter release

```sh
cd conversion
BROUTER_REF=v1.7.11 ./convert.sh   # J2K, about two minutes after the first run's downloads
./replay.sh                        # the passes, in order; a patch that no longer applies names its pass
cd .. && ../gradlew :brouter:jvmTest
parity/fetch.sh                    # brouter.de's answers for the new release, and its tiles
../gradlew :brouter:jvmTest :brouter:linuxX64ReleaseTest
```

A pass that no longer applies is rebased by re-running its script from `conversion/passes/` (each names every
edit and how many it expects) and recording it again with `record-pass.sh`. `replay.sh --check` proves the
committed tree is exactly J2K's output plus the passes. Read the Java diff of the release for new uses of JVM
APIs; those land in `btools/kmp`.

Upgrade `IDEA_VERSION` as a step of its own: a newer J2K changes the output throughout.

The IDE is JetBrains' Apache-2.0 open-source build, not the unified download: `docs/j2k-licensing.md`.

## The passes

| pass | what | why |
|---|---|---|
| 01 | imports: `java.io`, `java.util` to the shims, `btools.kmp.System` | common Kotlin has no JDK |
| 02 | `java.lang` statics: `Math`, `Boolean.getBoolean`, `Collections`, `String.format` | same |
| 03 | `kotlin.jvm` annotation imports | `@JvmField` and friends are not implicit in common code |
| 04 | JVM-only APIs: `Thread`, `Date`, `DecimalFormat`, `Cloneable`, `URLDecoder`, the stack sampler | same |
| 05a–05g | J2K's types: declarations, override signatures, nullability, asserts, accessor clashes | J2K output that does not compile |
| 05h | `(int) x` became `x as Int` | **throws on every route** |
| 05i | `float += double` became a narrowing before the addition | **one joule off in one column of three routes** |
| 06 | `OsmNodesMap.cleanupPeninsulas` as a loop | Kotlin/Native cannot catch a stack overflow |

05h and 05i are why parity is the gate: two of J2K's four behaviour changes compiled cleanly, and one showed
only in a byte comparison.

## The peninsula walk

Before searching, BRouter drops dead ends from the graph with a depth-first walk that recurses once per node
along a path, and wraps it in `catch (StackOverflowError)`: when a walk is too deep it gives up part-way,
keeping whatever it had already unlinked. On Kotlin/Native an overflow ends the process, so pass 06 makes the
walk a loop over an explicit stack — same visit order, same unlinking, and no giving up.

That is only the same result as brouter.de's if brouter.de never gives up on the routes that matter. Measured
with the original Java on the parity routes and this snapshot (2026-09-15):

- the deepest walk is **4,862 levels** (the long routes through Munich); most are under 3,500;
- **no route overflows even on a 512 KB thread stack**, and the output is identical at 16 MB, 1 MB and 512 KB;
- brouter.de routes each request on a `RouteServer` thread, and BRouter's server scripts set no `-Xss`, so it
  runs on the JVM's default of 1 MB.

So on these routes the loop is byte-identical to brouter.de, and parity holds it to that. A route deep enough
to overflow brouter.de's stack would come back different from the phone — a longer walk, more dead ends
dropped — and if one is ever found it becomes a documented exception, compared against the Java run on a large
stack instead.

## Parity

`parity/routes.tsv` is `id`, BRouter profile, `lonlats` — the request the web sends, one leg per line, with the
web's own conventions: a named point is a via (`lon,lat,name`), `m` is an unnamed via, a bare point is shaping.
It covers every app profile (road is `fastbike`, hiking is `hiking-mountain`), named and unnamed vias, shaping
points, three routes over 250 km through the Alps, and routes across both tiles.

`parity/fetch.sh` refreshes `parity/brouter.de/` — one request at a time, ten seconds apart, because brouter.de
is one enthusiast's server — and pins the tiles it was answered from in `parity/segments.txt`. brouter.de
rebuilds its tiles weekly, so the fixtures are only meaningful against that snapshot: it is published as a
release of this repository, and Gradle fetches it into `~/.cache/tracks/segments` and checks its sha256 before
the tests run. Nothing of it is in git.

brouter.de's `hiking-mountain.brf` is not v1.7.10's: it sets `SAC_access_penalty` to 999 instead of 9000,
commented as a performance fix. The phone routes with what the web routes with, so `profiles/` holds the
server's files.

`ParityTest` compares line by line, ignoring the `creator` line. It runs on the JVM and on native Linux (the
release binary: an unoptimised one takes minutes over the long routes); `TRACKS_BROUTER_ROUTES=id,id` narrows it.

## Known and accepted

- `synchronized` is a no-op on Native. One thread routes and nothing reads the engine while it does.
- `RoutingEngine` is no longer a `Thread`; callers run `doRun` on their own thread. The stack sampler is a stub,
  `System.exit` throws, and patch `patches/java/0001` removes the reflection BRouter used for its path model.
- On Linux the native build is about 1.9× slower than HotSpot on long routes and uses a sixth of the memory.
