package net.stho.tracks.ui.measure

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import kotlin.time.Clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.Rides
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.sensors.RideReplay
import okio.FileSystem
import okio.Path
import okio.buffer

/*
 * The ride measuring rig, shared by the desktop harness and the phone so that both write the same JSONL and one
 * analysis (`app/iosApp/ride-table.py`) reads both. How to run it: `app/docs/PROFILING.md`.
 *
 * What a ride costs is two quite different things added together: work done once per fix that arrives, and work
 * done once per frame that is drawn. They scale with different things and they have different fixes, so the rig
 * is built to separate them:
 *
 *   - **Depth is seeded, not ridden to.** The journal already is the ride's state and `Recorder.continueRide`
 *     reads it back, so a run starts at hour six instead of arriving there.
 *   - **Frames are counted, not assumed.** The map draws at the display's rate whatever the replay does, so at
 *     a replay speed of S a ridden second gets 60/S frames instead of 60. Recording frames and ridden seconds
 *     separately lets one run at two speeds solve
 *
 *         cpuMsPerRideS = perFix + framesPerRideSecond * perFrame
 *
 *     for both, without needing an ablation at all.
 *   - **Ridden seconds come from fixes that landed**, never from the nominal speed: the replay's loop emits and
 *     then delays, so it runs slower than asked while dropping nothing.
 */

/** What the platform can say about its own cost. Neither number exists in common Kotlin. */
expect fun processCpuSeconds(): Double

/** `nominal`, `fair`, `serious`, `critical` — or `unknown` where the platform has no such idea. */
expect fun thermalState(): String

/** 0..100, or null where there is no battery to ask about. */
expect fun batteryPercent(): Double?

/** Resident cost in MB, or null where the platform does not offer it cheaply. */
expect fun footprintMB(): Double?

/**
 * CPU seconds used so far by each of this process's threads, summed by thread name.
 *
 * The app's total says how much; this says **where** — on the device itself, which a simulator profile cannot:
 * the simulator's own Metal emulation took 18% of the render thread there. Unnamed threads (GCD's workers, mostly)
 * share one bucket, `unnamed`.
 */
expect fun threadCpuSeconds(): Map<String, Double>

/**
 * Remembers the calling thread as `main` in [threadCpuSeconds]. On iOS the main thread has no pthread name, so
 * without this it lands in `unnamed` beside GCD's workers — which is where Compose's own work was hiding.
 */
expect fun markCurrentThreadAsMain()

/**
 * Samples the cost of riding into [out], one JSON object per sample.
 *
 * [label] names the run — the ablation in force, or `baseline` — so a directory of runs reads as a matrix.
 */
class RideMeasure(
    private val out: Path,
    private val label: String,
    private val fileSystem: FileSystem = FileSystem.SYSTEM,
    private val nowNanos: () -> Long = { Clock.System.now().toEpochMilliseconds() * 1_000_000 },
) {
    private val startedAt = nowNanos()
    private var lastAt = startedAt
    private var lastCpu = processCpuSeconds()
    private var lastFrames = 0L
    private var lastDepth = 0
    private var lastHeadings = 0L
    private var lastMapFrames = 0L
    private var lastIdles = 0L
    private var lastRecompose = LongArray(4)
    private var lastThreads: Map<String, Double> = threadCpuSeconds()

    var frames = 0L

    init {
        // Built inside composition, so on the main thread: the moment to learn which thread that is.
        markCurrentThreadAsMain()
        out.parent?.let { fileSystem.createDirectories(it) }
        fileSystem.write(out) { writeUtf8("") }
    }

    fun sample(depth: Int, paused: Boolean) {
        val now = nowNanos()
        val cpu = processCpuSeconds()
        val wallS = (now - lastAt) / 1e9
        if (wallS <= 0) return

        val cpuS = cpu - lastCpu
        val frameCount = frames - lastFrames
        // See the note above: fixes that landed, not the nominal speed.
        val riddenS = (depth - lastDepth).toDouble().coerceAtLeast(1.0)

        val line = buildString {
            append("""{"label":"""").append(label).append('"')
            append(""","elapsedS":""").append(fixed((now - startedAt) / 1e9, 1))
            append(""","depth":""").append(depth)
            append(""","paused":""").append(paused)
            append(""","riddenS":""").append(fixed(riddenS, 1))
            append(""","wallS":""").append(fixed(wallS, 1))
            append(""","cpuMsPerRideS":""").append(fixed(cpuS * 1000 / riddenS, 3))
            append(""","cpuCores":""").append(fixed(cpuS / wallS, 3))
            append(""","fps":""").append(fixed(frameCount / wallS, 1))
            append(""","framesPerRideS":""").append(fixed(frameCount / riddenS, 2))
            append(""","headingsPerS":""").append(fixed((HeadingCalls.count - lastHeadings) / wallS, 2))
            append(""","mapFps":""").append(fixed((MapFrames.count - lastMapFrames) / wallS, 1))
            append(""","idlesPerS":""").append(fixed((MapIdles.count - lastIdles) / wallS, 2))
            val rc = longArrayOf(RecomposeCounts.riding, RecomposeCounts.ridingScreen, RecomposeCounts.tracksMap, RecomposeCounts.mapLibreMap)
            listOf("riding", "ridingScreen", "tracksMap", "mapLibreMap").forEachIndexed { i, name ->
                append(",\"recompose_").append(name).append("PerS\":").append(fixed((rc[i] - lastRecompose[i]) / wallS, 1))
            }
            lastRecompose = rc
            val threads = threadCpuSeconds()
            val busy = threads.mapValues { (name, secs) -> (secs - (lastThreads[name] ?: 0.0)) / wallS }
                .filterValues { it >= 0.005 }
                .entries.sortedByDescending { it.value }
            append(""","threads":{""")
            busy.forEachIndexed { i, (name, cores) ->
                if (i > 0) append(',')
                append('"').append(name.replace("\\", "/").replace("\"", "'")).append("\":").append(fixed(cores, 3))
            }
            append('}')
            lastThreads = threads
            append(""","thermal":"""").append(thermalState()).append('"')
            footprintMB()?.let { append(""","footprintMB":""").append(fixed(it, 1)) }
            batteryPercent()?.let { append(""","batteryPct":""").append(fixed(it, 1)) }
            append("}\n")
        }
        // Not `use`: okio's Closeable is not Kotlin's AutoCloseable on Native, so close by hand.
        val sink = fileSystem.appendingSink(out).buffer()
        try {
            sink.writeUtf8(line)
        } finally {
            sink.close()
        }

        lastAt = now
        lastCpu = cpu
        lastFrames = frames
        lastDepth = depth
        lastHeadings = HeadingCalls.count
        lastMapFrames = MapFrames.count
        lastIdles = MapIdles.count
    }
}

/** Two decimals without a platform formatter: Kotlin/Native has no `String.format`. */
private fun fixed(value: Double, places: Int): String {
    if (value.isNaN() || value.isInfinite()) return "null"
    var scale = 1L
    repeat(places) { scale *= 10 }
    val scaled = kotlin.math.round(value * scale).toLong()
    val whole = scaled / scale
    val part = (if (scaled < 0) -scaled else scaled) % scale
    if (places == 0) return whole.toString()
    val sign = if (value < 0 && whole == 0L) "-" else ""
    return "$sign$whole." + part.toString().padStart(places, '0')
}

/**
 * Clears [rides] and, when [fixes] is positive, writes a journal that deep and leaves it open — so the next
 * [Recorder] over [rides] finds one interrupted ride, exactly the one this run means to measure.
 *
 * **A measured run owns the rides directory.** Clearing is not tidiness: `Recorder.next()` offers the *oldest*
 * unfinished journal, so a run left over from the run before is what would be continued; and `Rides.start`
 * requires the journal not to exist, so a second run at the same depth aborts the app outright. Both were
 * found the hard way — four runs of a seven-run matrix died on the second, with SIGABRT and no samples.
 *
 * Must run before the [Recorder] is built, which decides what to offer by reading [rides] once.
 */
fun seedJournal(rides: Rides, replay: RideReplay, fixes: Int, now: Long, id: String = "seed") {
    rides.all().forEach { rides.delete(it.id) }
    val n = fixes.coerceAtMost(replay.fixes.size)
    if (n <= 0) return
    // Stamped as though the ride had been running for n seconds up to now, so the tally reads as a real one.
    val startedAt = now - n * 1000L
    rides.start(Entry.Started(id, startedAt, "seeded ride", null)).use { writer ->
        for (i in 0 until n) writer.append(Entry.Located(replay.fixes[i].copy(epochMillis = startedAt + i * 1000L)))
        writer.flush()
    }
    // No Stopped entry: the ride reads as interrupted, which is what continueRide picks up.
}

/**
 * Takes the ride up — a seeded journal if there is one, a fresh ride otherwise — and samples it every [everyS]
 * seconds until something stops it.
 *
 * Recording starts here rather than under a tap because a measured run is one nobody sits through.
 */
@Composable
fun MeasuredRide(recorder: Recorder, measure: RideMeasure, everyS: Double = 5.0, countFrames: Boolean = false) {
    LaunchedEffect(recorder, countFrames) {
        when (recorder.state.value) {
            is RecorderState.Interrupted -> recorder.continueRide()
            RecorderState.Idle -> recorder.start()
            else -> {}
        }
        // Awaiting a frame *asks* for one, so this loop drives the frame clock rather than only observing it:
        // with it running, fps is what the clock ticked, not necessarily what was drawn, and it may add work of
        // its own. `countFrames = false` runs the same ride without it, and the CPU difference between the two
        // is what the counter itself costs.
        if (countFrames) {
            launch {
                while (true) withFrameNanos { measure.frames++ }
            }
        }
        // Its own clock rather than the frame loop's, so a sample still lands when nothing is drawn at all —
        // which is itself a result worth having.
        launch {
            while (true) {
                delay((everyS * 1000).toLong())
                val state = recorder.state.value
                measure.sample(
                    depth = recorder.track.value.size,
                    paused = (state as? RecorderState.Recording)?.paused ?: false,
                )
            }
        }
    }
}

/**
 * The app's own floor: no ride, nothing recorded, the home screen with its map — sampled all the same.
 *
 * `cpuMsPerRideS` means nothing here, because no ride-seconds pass; `cpuCores` and `fps` are the numbers an
 * idle run contributes, and everything else is measured against them.
 */
@Composable
fun IdleMeasure(measure: RideMeasure, everyS: Double = 5.0, countFrames: Boolean = false) {
    LaunchedEffect(measure, countFrames) {
        if (countFrames) {
            launch {
                while (true) withFrameNanos { measure.frames++ }
            }
        }
        launch {
            while (true) {
                delay((everyS * 1000).toLong())
                measure.sample(depth = 0, paused = false)
            }
        }
    }
}
