package net.stho.tracks.ui.measure

/**
 * A measured run, as its launch asked for it. The phone reads these from its launch environment
 * (`pymobiledevice3 developer dvt launch --env`); `app/docs/PROFILING.md` lists them all.
 *
 * Null when the launch is not a measured one — no `TRACKS_RIDE_MEASURE` — and then nothing below is set at all.
 */
data class MeasureLaunch(
    /** `TRACKS_RIDE_MEASURE`: names the run, and its output `Documents/out/ride-<label>.jsonl`. */
    val label: String,
    /** `TRACKS_SEED`: start from a journal this many fixes deep, as though the ride had been running that long. */
    val seed: Int,
    /** `TRACKS_GPX`: replay this GPX from the app's Documents instead of the bundled ride. */
    val gpx: String?,
    /** `TRACKS_RIDE_FRAMES=1`: also count Compose frames. Off by default: counting asks for frames, and costs. */
    val countFrames: Boolean,
    /** `TRACKS_HEADING_HZ`: replace the compass with a synthetic one at this rate… */
    val headingHz: Double?,
    /** …`TRACKS_HEADING_JITTER` degrees either side of where it last pointed (default 3). */
    val headingJitter: Double,
    /** `TRACKS_REAL_SENSORS=1`: the phone's own CoreLocation for everything; no replay. */
    val realSensors: Boolean,
    /** `TRACKS_REAL_HEADING=1`: the replay's fixes with the phone's own compass — a compass at riding speed. */
    val realHeading: Boolean,
)

/**
 * Sets [MeasureOverrides] from [env]'s `TRACKS_FOLLOW_MS`, `TRACKS_MAX_FPS`, `TRACKS_HEADING_FILTER` and
 * `TRACKS_RIDING_ZOOM`. The phone's launch does it through [configureMeasurement]; the desktop harness, whose run is
 * set up by flags, takes the same names from its process environment.
 */
fun applyMeasureOverrides(env: (String) -> String?) {
    MeasureOverrides.followMs = env("TRACKS_FOLLOW_MS")?.toLongOrNull()
    MeasureOverrides.maxFps = env("TRACKS_MAX_FPS")?.toIntOrNull()
    MeasureOverrides.headingFilter = env("TRACKS_HEADING_FILTER")?.toDoubleOrNull()
    MeasureOverrides.ridingZoom = env("TRACKS_RIDING_ZOOM")?.toDoubleOrNull()
}

/**
 * Reads a measured launch from [env] and sets [Ablation.current] and [MeasureOverrides] from it — once, at launch.
 *
 * Returns null, and sets nothing, when `TRACKS_RIDE_MEASURE` is absent: a normal launch is never measured by accident.
 */
fun configureMeasurement(env: (String) -> String?): MeasureLaunch? {
    val label = env("TRACKS_RIDE_MEASURE") ?: return null
    Ablation.current = Ablation.of(env("TRACKS_ABLATE"))
    applyMeasureOverrides(env)
    return MeasureLaunch(
        label = label,
        seed = env("TRACKS_SEED")?.toIntOrNull() ?: 0,
        gpx = env("TRACKS_GPX"),
        countFrames = env("TRACKS_RIDE_FRAMES") == "1",
        headingHz = env("TRACKS_HEADING_HZ")?.toDoubleOrNull(),
        headingJitter = env("TRACKS_HEADING_JITTER")?.toDoubleOrNull() ?: 3.0,
        realSensors = env("TRACKS_REAL_SENSORS") == "1",
        realHeading = env("TRACKS_REAL_HEADING") == "1",
    )
}
