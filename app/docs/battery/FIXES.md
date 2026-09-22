# The battery fixes

`REPORT.md` found where a riding map's CPU goes and measured each lever alone. This lists the three levers as they
were built, and what is still owed: **the combined figure on the phone has not been measured yet**, because
signing the builds failed to authenticate (below).

## What changed

Three commits, one per lever, on top of `2391803`:

| commit | lever | what |
|---|---|---|
| `f6885e0` | the compass | `Riding` collects the heading and never reads it; it goes down as `heading: () -> Heading?` through `RidingScreen` to `TracksMap`, which reads it only in snapshot flows: the rider source the facing cone turns by, and the Follow camera. The camera reads it only where `mapBearing` uses it — `compassTurnsMap` in `Bearing.kt`: heading-up, below `COURSE_MIN_SPEED_MPS` or without a course. `mapBearing` stays outside the flow, since it reads the camera's own bearing. `headingFilter` 1° → 5°. |
| `47e7e3d` | the camera | `FOLLOW_MS` 950 → 250. Centre and Show keep 950 ms under a new name, `FLIGHT_MS`: a journey asked for once, not a step a second. |
| `ed57f98` | the frame cap | `RenderOptions { maximumFps = 15 }`, lifted to `RenderOptions.Standard` while a finger is on the map, while the camera moves for a gesture (a fling), while the app flies the camera (Centre, Show, Overview, and Follow's first step from wherever the map was), and while a routing leg pulses. Derived state, so the camera starting and stopping each second recomposes nothing unless the answer changes. |

The placement cross-fade switch is not used: `MapStyleState.setPlacementTransitions` is still internal in
maplibre-compose 0.16.0, and its suppression stays in the rig.

Checked: `:ui:jvmTest`, `:shared:jvmTest`, `:ui:compileKotlinIosArm64`, `:desktopApp:compileKotlin`. Two new tests in
`BearingTest`: where `compassTurnsMap` is true, and that wherever it is false the heading changes nothing that
`mapBearing` returns.

**Not checked by a person.** The cap, its lifts and the 250 ms step are reasoned to look right: a fix moves the map a
few pixels at riding zoom. Nobody has yet ridden or panned the map on the phone to watch for a stutter.

## The measurement

Both builds were archived on the macOS runner in one session and installed on the SE2 (iOS 26.6.2), unplugged:

- **A**: `origin/main` (`2391803`) plus the rig, ported onto main's overlays-in-the-style `TracksMap`.
- **B**: these three commits plus the same rig. In B, `TRACKS_MAX_FPS` replaces the cap's 15 (`0` switches the cap
  off) and `TRACKS_FOLLOW_MS` the 250, so one build can switch each lever back for attribution.

Replay of activity 205, seed 15000, 100 s a run, medians of the samples after the first 15 s, in one session ordered
A → B → A. The outcome bands were written before any run (the investigation's scratchpad, `fixes/bands.txt`).
Drift between repeated runs: 0.007, 0.000 and 0.001 cores, so any lever above ~0.02 is real. Thermal state was
nominal throughout.

| run | cores | map fps | recomposes/s (Riding / RidingScreen / TracksMap / MaplibreMap) |
|---|---|---|---|
| main, 1 Hz compass | 0.605 | 60 | 1 / 1 / 1 / 1 |
| main, 30 Hz compass | 0.630 | 60 | 29 / 29 / 29 / 29 |
| **fixes, 1 Hz compass** | **0.363** | 11 | 1 / 1 / 1 / 1 |
| **fixes, 30 Hz compass** | **0.476** | 14 | 1 / 1 / 1 / 1 |
| fixes, cap off | 0.518 | 60 | |
| fixes, glide back to 950 ms | 0.609 | 15 | |
| fixes, 30 Hz, cap off | 0.560 | 60 | |
| fixes, placement cross-fade off as well | 0.365 | 11 | |
| main + cap 15 (no lifts) + 250 ms, 30 Hz | 0.618 | 15 | 28 / 28 / 28 / 28 |
| no map (floor), main / fixes | 0.029 / 0.028 | 0 | |

**Combined: −40% of the app's CPU with the compass quiet (0.605 → 0.363), −24% with it speaking at 30 Hz
(0.630 → 0.476).** The fixes land at 0.60 of main, in the middle band rather than the hoped-for ≤ 0.50, yet squarely
inside the guessed 0.30–0.38 cores: main itself has come down from the investigation's 0.68 now that its overlays
live in the style.

What each lever is worth, switching it back on the fixes build (the levers overlap, so these do not add up):

- **The 250 ms step: 0.246 cores**, the largest, and far above the band's 0.03–0.10. With a 950 ms glide the camera
  moves almost all of every second, and a capped moving camera still costs nearly what an uncapped one does
  (0.609, i.e. main's figure). The glide and the cap only pay together.
- **The 15 fps cap: 0.155 cores** at 1 Hz (inside the band's 0.15–0.30), 0.084 at 30 Hz.
- **The compass changes: 0.142 cores** at 30 Hz (main with the cap and the 250 ms step, against the fixes). On main,
  the cap and the step alone bought almost nothing at 30 Hz (0.630 → 0.618): 28 recompositions a second each
  restarting the camera glide keep it moving whatever its duration. The heading read in the map is what lets the
  other two levers work under a live compass.
- **The placement cross-fade switch: nothing** (+0.003). Once the map rests between steps there is no fade to cut, so
  the upstream `setPlacementTransitions` is not worth waiting for.

What surprised the bands:

- **A 30 Hz compass still costs 0.113 cores on the fixes** (band: > 0.10, "look at the recompose counters"). The
  counters are clean — 1 recomposition a second on every riding composable — so it is not recomposition. The cost is
  in drawing: map fps rises from 11 to 14 and the map idles once a second instead of twice. Each heading still
  changes the facing cone, so the map that would otherwise rest between steps draws up to the cap. On main the same
  compass cost only 0.025 because the map was drawing 60 fps regardless. This is the next lever if one is wanted —
  e.g. turning the cone only on changes of a few degrees, or not at all above walking pace.
- The replay delivers one heading per heading event whatever `headingFilter` is, so the 5° filter is unmeasured
  here; on a real ride it can only lower the 30 Hz figure towards the 1 Hz one.

## The 5° heading filter, measured

A second session on the SE2 (2026-09-22), with the rig switched to the replayed ride's fixes and the phone's **real**
compass (`TRACKS_REAL_HEADING=1`), and `headingFilter` overridden (`TRACKS_HEADING_FILTER`). The ride is above walking
pace, so the compass turns only the facing cone, not the camera. The phone was held in the hand and swayed as on a
handlebar, filter 1° / 5° / 1° / 5°, then laid on the desk. Bands written first, in the scratchpad's
`fixes/filter-bands.txt`.

| run | headings/s | cores | over the replay's compass (0.363) |
|---|---:|---:|---:|
| replay compass, 1 heading/s (reference, start / end) | 1.0 | 0.394 / 0.363 | — |
| hand, 1° | 9.5 | 0.438 | +0.075 |
| hand, 5° | 4.1 | 0.408 | +0.045 |
| hand, 1° again | 32.1 | 0.475 | +0.112 |
| hand, 5° again | 5.6 | 0.419 | +0.056 |
| desk, 1° | 0.0 | 0.367 | +0.004 |
| desk, 5° | 0.0 | 0.364 | +0.001 |

The reference is 0.363, the end run, which matches the previous session's fixes build (0.363) and the desk runs. The
first run of the session read 0.394, with the extra entirely on GCD worker threads (0.072 against 0.044 in every
other run): the first launch after an install, and not the app's own work.

- **The filter does its job on the heading count:** 4–6 headings a second at 5°, whatever the hand did, against 9.5
  and 32 at 1° as the sway varied. The 5° runs repeat within 0.011 cores; the 1° runs, 0.038 apart, follow the motion.
- **It roughly halves what a moving compass costs:** +0.045–0.056 cores at 5° against +0.075–0.112 at 1°. Not in
  proportion to the headings, as the bands expected: at 15 fps the map is either resting or drawing, and four or five
  headings a second already keep it drawing much of the time (13 fps against 11 on the replay's compass).
- **A still phone costs nothing** at either filter: CoreLocation delivers no headings at all.
- **Left:** ~0.05 cores (≈14% of the navigating app) while the phone is moving on the bar. That is the facing cone's
  turning keeping the map from resting — turning it only on larger changes, or drawing it without a symbol re-layout,
  is where it would go. The magnetometer's own power is outside the app's CPU and not measured.
