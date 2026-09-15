package net.stho.tracks.ui.sensors

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flow
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.distanceM
import net.stho.tracks.sensors.pressureAt

private fun Double.radians() = this * PI / 180.0

/** The initial bearing from [a] to [b], degrees clockwise from true north, in [0, 360). */
fun bearingDeg(a: Coordinate, b: Coordinate): Double {
    val y = sin((b.lon - a.lon).radians()) * cos(b.lat.radians())
    val x = cos(a.lat.radians()) * sin(b.lat.radians()) -
        sin(a.lat.radians()) * cos(b.lat.radians()) * cos((b.lon - a.lon).radians())
    return (atan2(y, x) * 180.0 / PI + 360.0) % 360.0
}

/** Below this a replayed rider is standing, and has no course: a GPS reports none either. */
private const val STANDING_MPS = 0.3

/**
 * A ride resampled to the phone's 1 Hz: one [Fix] per second from the first point's time to the last's.
 *
 * Positions are interpolated in time between the file's points, so a sparse file replays as smooth motion and a
 * stop — two points at one place, apart in time — replays as standing still. Speed is the segment's, course the
 * segment's direction while moving and null while standing. A file without times is ridden at [assumedSpeedMps].
 */
class RideReplay(points: List<TrackPoint>, assumedSpeedMps: Double = 18.0 / 3.6) {
    val track: List<Coordinate> = points.map { it.at }
    val fixes: List<Fix>

    /** Where the rider faces each second: the last course, held through a stop, as a compass on the bars reads it. */
    val headings: List<Double?>

    init {
        require(points.isNotEmpty()) { "a ride needs at least one point" }
        val timed = points.all { it.epochMillis != null } &&
            points.zipWithNext().all { (a, b) -> b.epochMillis!! >= a.epochMillis!! }
        val times = if (timed) {
            points.map { it.epochMillis!! }
        } else {
            var t = 0.0
            points.indices.map { i ->
                if (i > 0) t += distanceM(points[i - 1].at, points[i].at) / assumedSpeedMps * 1000
                t.roundToLong()
            }
        }
        val start = times.first()
        val seconds = floor((times.last() - start) / 1000.0).toInt()

        val fixes = ArrayList<Fix>(seconds + 1)
        val headings = ArrayList<Double?>(seconds + 1)
        var segment = 0
        var facing = points.zipWithNext().firstOrNull { (a, b) -> distanceM(a.at, b.at) > 0 }
            ?.let { (a, b) -> bearingDeg(a.at, b.at) }
        for (second in 0..seconds) {
            val t = start + second * 1000L
            while (segment < points.size - 2 && times[segment + 1] <= t) segment++
            val a = points[segment]
            val b = points.getOrElse(segment + 1) { a }
            val duration = times.getOrElse(segment + 1) { times[segment] } - times[segment]
            val fraction = if (duration <= 0) 1.0 else ((t - times[segment]).toDouble() / duration).coerceIn(0.0, 1.0)
            val length = distanceM(a.at, b.at)
            val speed = if (duration <= 0) 0.0 else length / (duration / 1000.0)
            val moving = speed >= STANDING_MPS
            val course = if (moving) bearingDeg(a.at, b.at) else null
            if (course != null) facing = course
            fixes += Fix(
                at = Coordinate(a.at.lat + (b.at.lat - a.at.lat) * fraction, a.at.lon + (b.at.lon - a.at.lon) * fraction),
                altitudeM = interpolate(a.elevationM, b.elevationM, fraction),
                courseDeg = course,
                speedMps = if (moving) speed else 0.0,
                accuracyM = 5.0,
                epochMillis = t,
            )
            headings += facing
        }
        this.fixes = fixes
        this.headings = headings
    }

    private fun interpolate(a: Double?, b: Double?, fraction: Double): Double? = when {
        a != null && b != null -> a + (b - a) * fraction
        else -> a ?: b
    }

    companion object {
        fun gpx(xml: String) = RideReplay(Gpx.trackPoints(xml))
    }
}

/**
 * A [RideReplay] as the desktop's [Sensors]: a fix, a compass heading and a barometer reading every second,
 * stamped with the wall clock as a live source would be.
 *
 * [fromSecond] starts part-way into the ride; [speedup] plays it faster without changing what each second says.
 */
class ReplaySensors(
    private val replay: RideReplay,
    private val fromSecond: Int = 0,
    private val speedup: Double = 1.0,
) : Sensors {
    private fun <T : Any> replayed(value: (second: Int, now: Long) -> T?): Flow<T> = flow {
        for (second in fromSecond until replay.fixes.size) {
            emit(value(second, Clock.System.now().toEpochMilliseconds()))
            delay((1000 / speedup).milliseconds)
        }
    }.filterNotNull()

    override val fixes: Flow<Fix> = replayed { second, now -> replay.fixes[second].copy(epochMillis = now) }

    override val headings: Flow<Heading> = replayed { second, now -> replay.headings[second]?.let { Heading(it, now) } }

    override val pressures: Flow<Pressure> =
        replayed { second, now -> replay.fixes[second].altitudeM?.let { Pressure(pressureAt(it), now) } }
}
