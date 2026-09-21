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

## The measurement, prepared but not taken

Both builds were archived on the macOS runner in one session and pulled back, unsigned:

- **A**: `origin/main` (`2391803`) plus the rig, ported onto main's overlays-in-the-style `TracksMap`.
- **B**: these three commits plus the same rig. In B, `TRACKS_MAX_FPS` replaces the cap's 15 (`0` switches the cap
  off) and `TRACKS_FOLLOW_MS` the 250, so one build can switch each lever back for attribution.

The outcome bands were written before any run, in the investigation's scratchpad at `fixes/bands.txt`, and the run
script (`fixes/run.sh A1 | B | A2`: A, then B, then A again as the drift check) and the table (`fixes/table.py`) are
beside them. The planned runs: 1 Hz and 30 Hz compass and the no-map floor on each build; on B, the cap off, the
950 ms glide, the cap off at 30 Hz, and the placement cross-fade off; on A, cap 15 with 250 ms at 30 Hz, which
against B at 30 Hz isolates the compass changes.

**Signing failed:** `secrets-env` could not decrypt its token (`systemd-creds decrypt failed`), three times, so
nothing was installed. It is the step that may need a fingerprint. Once it authenticates, the rest is
`sign` × 2, the lease, and about 40 minutes on the phone.

The `headingFilter` change cannot be measured on a replay at all: a replay delivers one heading a second whatever the
filter is. Only the changes downstream of the compass can be.
