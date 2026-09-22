# Where the battery goes on a ride

The first long ride on the app, activity 205 (Meran – Tösens, 2026-09-19: 111 km, 8 h 16, 29,653 fixes at 1 Hz), came
back "ok, but not great". This finds where a navigating app's CPU goes, fixes the largest part of it, and leaves the
rig that measured it in place for the next change (`PROFILING.md`).

**Every figure is app CPU, in cores of the SE2's A13, while replaying that ride from fix 15,000.** None is energy.
A run is launched over USB, and USB charges the phone, so %/h has to come from a ride. Screen, GPS and magnetometer
power are outside the app's CPU and not in any number here.

## The answer

| | before | after |
|---|---:|---:|
| navigating, quiet compass | 0.605 cores | **0.363** (−40%) |
| navigating, compass at 30 headings/s | 0.630 | **0.476** (−24%) |
| the app with no map | 0.035 | 0.035 |
| MapLibre's frames per second | 60 | 11–15 |

"Before" is main at `2391803`. An older main measured 0.68, before it moved its overlays into the style.

**What cost it.** The map, nearly all of it. MapLibre re-runs symbol placement after any change on the map, and
cross-fades the labels it places. It draws at the display's rate while a fade runs, so a map with anything changing
once a second never rested. Three things kept it changing, built up from the floor:

| layer | cores |
|---|---:|
| the app with no map | 0.035 |
| **map pinned at 60 fps by any recurring change** (the placement cross-fade) | +0.44 |
| camera gliding to each fix for 950 ms of every 1000 | +~0.19 |
| compass at a moving rate (~30/s), each heading recomposing the whole riding screen | +0.12–0.15 |

**What changed**, on this branch:

| change | where | worth |
|---|---|---|
| The camera **steps** to each fix in 250 ms instead of gliding | `FOLLOW_MS`, `TracksMap.kt` | 0.246 cores |
| The map draws at most **15 fps**, lifted for a finger, a fling, a flight the app asked for and the routing pulse | `MAX_FPS`, `TracksMap.kt` | 0.155 |
| The compass is read **only by the map**, turns it **only below walking pace**, and speaks every **5°** | `Riding.kt`, `Bearing.kt`, `LocationSensors.kt` | 0.142 at 30 headings/s |
| The riding map follows at zoom **15.05**, not 15 | `RIDING_ZOOM`, `RidingScreen.kt` | ~0.01, and a label fix |
| The map turns only when the course has moved **more than 10°** from the map's bearing | `steadyBearing`, `Bearing.kt` | a label fix; CPU unmeasured |

The levers overlap, so the "worth" column doesn't add up. Each figure is what switching that one lever back
costs on the fixed build. **The step and the cap only pay together:** with the 950 ms glide back, the capped map
costs what main does (0.609).

**What is left:**
- **The heading cone:** about 0.05 cores while the phone moves on the bar. Each heading turns it, so a map that
  would otherwise rest between fixes draws up to the cap. Turning the cone only on larger changes would be the
  next lever.
- **A dimmer riding style:** unmeasured. The SE2's LCD can't show what a dark style saves on the XS's OLED.
- **A rarer lock-screen snapshot:** unmeasured.
- **Energy:** %/h, on a ride.

## How it was found

Measurement ran from cheap to real: a JVM benchmark (T0), the desktop harness (T1), the simulator (T2), and then
the phone (T3), where every conclusion below comes from. A 100-second run was one data point. Each session
repeated its baseline, and drift between repeats stayed at or under 0.013 cores.

**The ridden line was the first suspect, and is innocent.** Re-serialising the whole line once a second builds
9.6 GB of string over the ride (T0), and MapLibre re-parses every byte of it. Freezing it on the phone changed app
CPU by −0.1%. Depth cost nothing either: 0.707 cores at 2,000 fixes, 0.685 at 27,000. Main has since dropped
`linesJson` anyway.

**The map was 86% of the app** (0.681 → 0.093 with no map). The first reading said 39%. The rig's frame counter
asked for frames, and with the map gone it drove 60 Hz of Compose rendering by itself (0.325 cores). The rig now
counts MapLibre's own `FrameRendered` events instead, and the Compose counter is off by default.

**Capping the redraw alone bought only 14%.** It was the first recommendation, handed to a workspace that capped
the map at 4 fps and measured it under the 950 ms glide. That workspace was dropped, and its write-up is folded
into this section. The cap was re-measured once the camera was fixed: at 15 fps under a still camera it recovers
60% of the map's cost, at 4 fps 71%.

**The camera glide.** The camera animated for 950 ms of every 1000 between fixes, so the map was always changing.
A still camera saved 29% of the map's cost. Shortening the glide saved in proportion to the time the camera then
stood still: 11.9% of the map's cost at 500 ms, 19.6% at 250 ms, against a model's 13.6% and 21.2%.

**The heading.** A replay delivers one heading a second, which hid the compass's cost. A synthetic compass
(`TRACKS_HEADING_HZ`) showed it: 0.554 cores at 1 Hz, 0.641 at 10 Hz and 0.692 at 30 Hz. A phone moved by hand
delivered 26–36 headings a second at the old 1° filter, and none while still. Each heading recomposed `Riding`,
`RidingScreen`, `TracksMap` and `MapLibreMap`, 28 times a second each. The cost was spread across its consumers:

| consumer of each heading | share |
|---|---:|
| `Riding` and `RidingScreen` recomposing, though neither reads it | 33% |
| the facing cone's `icon-rotate`, a layout property, so a re-layout | 23% |
| `TracksMap` and `MapLibreMap` recomposing | 23% |
| the camera glide restarting | 21% |

That is why the fix is both structural and about rate. Read in the map, a heading recomposes nothing: on the
fixed build that's 1 recomposition a second even at 30 headings a second. A 5° filter makes headings rare.

**The ~0.44-core floor: any recurring change pins MapLibre at 60 fps.** With the camera still, the map still cost
0.49 cores. It turned out to be all-or-nothing:
- Freezing every changing element (puck, cone, line, compass) removed all of it, and an idle map costs nothing.
- Freezing any one element removed none of it, and neither did changing the map every 5 s instead of every 1 s.
- Hiding every base-style label removed none of it.
- Any single element switched back on, even a plain `CircleLayer` dot, brought back 60 frames a second and
  ~0.44 cores.

**Root cause: the symbol placement cross-fade.** With the cross-fade off, a dot moving once a second draws at
5 fps instead of 60, and gives back 88% of its cost. It is the mechanism of
[SkyFollower #1830](https://github.com/BrentIO/SkyFollower/issues/1830). The switch,
`MapStyleState.setPlacementTransitions`, is `internal` in maplibre-compose 0.16.0, so the fix uses the public
frame cap. On the fixed build, switching the cross-fade off as well adds nothing (+0.003), so it isn't worth
asking upstream for any more.

**Ruled out, each measured at or near nothing:** the ridden line and `linesJson`, `Recorder`'s list copy, the line's
depth, the base style's labels, the map's update rate, the `LocationPuck` as such, an interop view as such, and
`CADisableMinimumFrameDurationOnPhone` (both phones are 60 Hz).

## The fixes, measured

One session on the SE2, ordered main → fixes → main. The two main runs differed by 0.007 cores, and the fixes'
repeat by 0.001. Thermal state stayed nominal throughout.

| run | cores | map fps | recompositions/s (the four composables) |
|---|---:|---:|---|
| main, 1 heading/s | 0.605 | 60 | 1 |
| main, 30 headings/s | 0.630 | 60 | 29 |
| **fixes, 1 heading/s** | **0.363** | 11 | 1 |
| **fixes, 30 headings/s** | **0.476** | 14 | 1 |
| fixes, cap off | 0.518 | 60 | |
| fixes, 950 ms glide back | 0.609 | 15 | |
| fixes, cross-fade off as well | 0.365 | 11 | |
| main + 15 fps cap + 250 ms step, 30 headings/s | 0.618 | 15 | 28 |
| no map, main / fixes | 0.029 / 0.028 | 0 | |

On main, the cap and the step alone did nothing at 30 headings a second (0.630 → 0.618). Every heading restarted
the glide, so the camera never stood still. Reading the heading in the map is what lets the other two work under a
live compass.

**The 5° filter**, measured with the phone's real compass during the replayed ride (`TRACKS_REAL_HEADING`). The
phone was swayed by hand, 1° / 5° / 1° / 5°, then laid on the desk. The reference is the same ride with a quiet
compass, at 0.363:

| | headings/s | above a quiet compass |
|---|---:|---:|
| hand, 1° | 9.5 / 32.1 | +0.075 / +0.112 cores |
| hand, 5° | 4.1 / 5.6 | +0.045 / +0.056 |
| desk, either | 0 | ~0 |

The filter roughly halves what a moving compass costs. The 1° runs track the hand's motion, while the two 5° runs
agree within 0.011 cores.

**Zoom 15.05, and labels.** River and contour names disappeared and reappeared in place once a second. Every
camera step is a MapLibre `flyTo`, which zooms out a few thousandths mid-flight even between two equal zooms.
MapLibre picks vector tiles by the zoom rounded down, so at exactly 15 each step switched the tiles to 14 and back.
Line labels are laid out per tile zoom, so they were re-placed each time. Both runs at 15.0 flickered and neither
run at 15.05 did, and 15.05 was 0.008–0.015 cores cheaper.

The remaining effect was a direction swap. A river running along the road sits near vertical on a heading-up map,
and the course's wobble of a few degrees tipped it back and forth past vertical. MapLibre flips a line label past
vertical to keep it readable, so the names swapped direction every second. The 10° turning threshold addresses
that; it has not been ridden yet.

## Measuring it again

The rig that took every number here stays in the app, so the next change to one of these levers is measured the
same way. How to run it: `app/docs/PROFILING.md`.
