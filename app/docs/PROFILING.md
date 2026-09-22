# Profiling a ride

How to measure what riding costs on a real iPhone. The app replays a recorded ride, starting hours deep, and samples
its own CPU every five seconds. The rig was built for the battery investigation (`BATTERY.md`, which has what it
found). It stays so the next change to the map, the camera or the compass is measured the same way, against the same
numbers.

**It measures CPU, not energy.** A run is launched over USB, and USB charges the phone. Screen, GPS and magnetometer
power are outside the app's CPU.

## The parts

- **In the app:** `app/ui/src/*/…/ui/measure/`, with hooks in `TracksMap`, `Riding`, `RidingScreen`,
  `MainViewController` and the desktop harness.
- **On the host:** `app/iosApp/ride-measure.sh` runs a plan, `ride-table.py` reads the results, `activity-gpx.py`
  exports a ride from the database, and `ride-plans/` holds example plans.

> **A measured launch deletes every ride on the phone.** It has to: the recorder continues the oldest unfinished
> journal, and a journal left over from an earlier run would be the one it picks. Only measure on a test phone.

## Measuring on the phone

1. Export a ride with `secrets-env -- app/iosApp/activity-gpx.py 205 ride-205.gpx`. The bundled ride is 179
   points, too short to start deep in.
2. Build, sign and install a Release build with the ios-device skill, and take the lease. Keep the phone on USB,
   unlocked, with Auto-Lock off.
3. Write down what you expect before the first run, and what would falsify it.
4. Run `app/iosApp/ride-measure.sh --ipa app.ipa --gpx ride-205.gpx app/iosApp/ride-plans/levers.plan`.
5. Read the results with `app/iosApp/ride-table.py <results> base:base-end base:cap-off …`.

### Plans

A plan has one run per line: a label, then launch switches as `KEY=VALUE`. A `say <text>` line shows a
notification in CodeHydra and waits 20 s, for runs that need someone to hold the phone. Every run replays from
`RIDE_SEED` (15000) for `RIDE_HOLD` seconds (100).

## Launch switches

| switch (launch env) | does |
|---|---|
| `TRACKS_RIDE_MEASURE=<label>` | Measure this launch, into `Documents/out/ride-<label>.jsonl`. None of the others apply without it |
| `TRACKS_GPX=<file>`, `TRACKS_SEED=<n>` | Replay this GPX from Documents, starting from a journal n fixes deep |
| `TRACKS_ABLATE=` `NoMap` · `NoHeading` · `Idle` · `StaticCamera` | Switch off the map, the compass, the ride, or following |
| `TRACKS_FOLLOW_MS` · `TRACKS_MAX_FPS` (0 = off) · `TRACKS_RIDING_ZOOM` · `TRACKS_HEADING_FILTER` | The product's constants, overridden for one run |
| `TRACKS_HEADING_HZ=<hz>` (`TRACKS_HEADING_JITTER`, default 3°) | A synthetic compass at that rate, reproducible where a hand is not |
| `TRACKS_REAL_HEADING=1` · `TRACKS_REAL_SENSORS=1` | The phone's own compass during the replay, or its own CoreLocation for everything |
| `TRACKS_RIDE_FRAMES=1` | Also count Compose frames. Off by default, because counting asks for frames |

The desktop harness takes `--measure`, `--seed` and `--ablate` as flags, and the same overrides from its
environment.

## What a sample holds

Each sample is one JSON line every 5 s. `ride-table.py` shows medians after the first 15 s, which carry the launch.
- `cpuCores` is the number that matters.
- `threads` splits it by thread: `maplibre-compose-render` is MapLibre drawing, `unnamed` is mostly GCD's workers
  laying out tiles, `main` is Compose, and `Main GC thread` is Kotlin/Native's collector.
- `mapFps` and `idlesPerS` show whether the map rests.
- `headingsPerS` and `recompose_*PerS` count headings and recompositions.
- `thermal`: runs that are not `nominal` don't compare.

## Method

Each point was learned the hard way:

- Run the baseline first and last. Don't claim a lever smaller than three times their difference.
- Ignore the first run after an install; one read 0.03 cores high, all of it on GCD threads.
- Ablations don't add up: the camera's saving and the puck's were the same work.
- Keep new counters plain `Long`s, never Compose state, so counting doesn't change what it counts.
- To add a lever, give `MeasureOverrides` a nullable field, read it in `applyMeasureOverrides`, and use
  `MeasureOverrides.x ?: X` where the product uses the constant.
