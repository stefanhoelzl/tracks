package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import net.stho.tracks.codec.jsRound
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The elevation profile's measurements, from `packages/web/src/lib/geo.ts`, the ramp from `lib/chart-theme.ts`, and
 * `profileOf` from `components/ElevationProfile.tsx`: what the phone draws is what the web draws — the absolute ramp,
 * one paint for line and area, a 200 m minimum span. Pinned by `terrain.json`.
 */

private const val EARTH_M = 6_371_000.0
private const val RAD = PI / 180

/** The distance a gradient is measured across, centred on the point it belongs to. */
const val GRADIENT_WINDOW_M = 100.0

internal fun haversine(a: Coordinate, b: Coordinate): Double {
    val dLat = (b.lat - a.lat) * RAD
    val dLon = (b.lon - a.lon) * RAD
    val sinLat = sin(dLat / 2)
    val sinLon = sin(dLon / 2)
    val h = sinLat * sinLat + cos(a.lat * RAD) * cos(b.lat * RAD) * sinLon * sinLon
    return 2 * EARTH_M * asin(min(1.0, sqrt(h)))
}

/** Metres along the track at each point, scaled so the last lands on [reportedM] when there is one. */
internal fun cumulativeDistances(coordinates: List<Coordinate>, reportedM: Double?): List<Double> {
    val out = DoubleArray(coordinates.size)
    var running = 0.0
    for (i in coordinates.indices) {
        if (i > 0) running += haversine(coordinates[i - 1], coordinates[i])
        out[i] = running
    }
    if (reportedM == null || running <= 0) return out.toList()
    val scale = reportedM / running
    return out.map { it * scale }
}

/** The position of the nearest value in an ascending list; ties go to the later one, as in the web. */
internal fun nearestInSorted(values: List<Double>, target: Double): Int {
    if (values.isEmpty()) return -1
    var low = 0
    var high = values.size - 1
    while (low < high) {
        val mid = (low + high) shr 1
        if (values[mid] < target) low = mid + 1 else high = mid
    }
    if (low > 0 && abs(values[low - 1] - target) < abs(values[low] - target)) return low - 1
    return low
}

/** Gradient at each point in percent, across a centred window; null where nothing measured is near enough. */
internal fun gradients(distances: List<Double>, altitudeM: List<Double?>, windowM: Double = GRADIENT_WINDOW_M): List<Double?> {
    val count = distances.size
    val out = arrayOfNulls<Double>(count)
    if (count == 0) return out.toList()

    val after = IntArray(count)
    val before = IntArray(count)
    var seen = -1
    for (i in 0 until count) {
        if (altitudeM[i] != null) seen = i
        before[i] = seen
    }
    seen = -1
    for (i in count - 1 downTo 0) {
        if (altitudeM[i] != null) seen = i
        after[i] = seen
    }

    val half = windowM / 2
    var low = 0
    var high = 0
    for (i in 0 until count) {
        val here = distances[i]
        while (distances[low] < here - half) low++
        while (high + 1 < count && distances[high + 1] <= here + half) high++

        var first = after[low]
        var last = before[high]
        if (first < 0 || last < 0 || first > high || last < low || first >= last) {
            if (altitudeM[i] == null) continue
            first = if (i == 0 || altitudeM[i - 1] == null) i else i - 1
            last = if (i + 1 >= count || altitudeM[i + 1] == null) i else i + 1
            if (first == last) continue
        }

        val run = distances[last] - distances[first]
        if (run <= 0) continue
        out[i] = ((altitudeM[last]!! - altitudeM[first]!!) / run) * 100
    }
    return out.toList()
}

/** Which points the profile draws: Ramer–Douglas–Peucker on altitude, runs never crossing a dropout, spans capped. */
internal fun drawnIndices(distances: List<Double>, altitudeM: List<Double?>, toleranceM: Double, capM: Double): List<Int> {
    val out = ArrayList<Int>()
    val count = distances.size
    var i = 0
    while (i < count) {
        if (altitudeM[i] == null) {
            out.add(i)
            while (i < count && altitudeM[i] == null) i++
            continue
        }
        val start = i
        while (i < count && altitudeM[i] != null) i++
        spread(out, distances, simplify(distances, altitudeM, start, i - 1, toleranceM), capM)
    }
    return out
}

private fun simplify(distances: List<Double>, altitudeM: List<Double?>, start: Int, end: Int, toleranceM: Double): List<Int> {
    val keep = BooleanArray(end - start + 1)
    keep[0] = true
    keep[end - start] = true

    val pending = ArrayDeque<Pair<Int, Int>>()
    pending.addLast(start to end)
    while (pending.isNotEmpty()) {
        val (from, to) = pending.removeLast()
        if (to - from < 2) continue

        val base = altitudeM[from]!!
        val rise = altitudeM[to]!! - base
        val run = distances[to] - distances[from]

        var worst = -1
        var deepest = toleranceM
        for (at in from + 1 until to) {
            val projected = if (run > 0) base + (rise * (distances[at] - distances[from])) / run else base
            val deviation = abs(altitudeM[at]!! - projected)
            if (deviation > deepest) {
                deepest = deviation
                worst = at
            }
        }
        if (worst < 0) continue

        keep[worst - start] = true
        pending.addLast(from to worst)
        pending.addLast(worst to to)
    }

    return (0..end - start).filter { keep[it] }.map { start + it }
}

private fun spread(out: MutableList<Int>, distances: List<Double>, kept: List<Int>, capM: Double) {
    out.add(kept[0])
    for (k in 1 until kept.size) {
        val from = kept[k - 1]
        val to = kept[k]
        val span = distances[to] - distances[from]
        val parts = if (capM > 0) ceil(span / capM).toInt() else 1
        for (step in 1 until parts) {
            val at = nearestInSorted(distances, distances[from] + (span * step) / parts)
            if (at > out.last() && at < to) out.add(at)
        }
        out.add(to)
    }
}

/** A track's terrain, as the profile draws it: every list is per drawn point. */
data class Terrain(
    /** Metres along the track, scaled to the reported distance. */
    val distances: List<Double>,
    val altitudeM: List<Double?>,
    /** Percent; null where the window had nothing to measure. */
    val gradients: List<Double?>,
    /** Each drawn point's index into the track. */
    val trackIndex: List<Int>,
    val totalM: Double,
) {
    /**
     * The ramp laid along the line, as `rampAlong` in ElevationProfile.tsx lays it: stops at fractions of the span
     * between the first and last measured points, a plateau keeping only its two ends. Null when there is nothing to
     * colour, which is drawn in neutral ink; a null gradient is ink too (as null in the stop).
     */
    fun rampStops(): List<Pair<Double, Int?>>? {
        val drawn = altitudeM.indices.filter { altitudeM[it] != null }
        if (drawn.isEmpty()) return null
        val first = distances[drawn.first()]
        val span = distances[drawn.last()] - first
        if (span <= 0) return null

        val colours = drawn.map { at -> gradients[at]?.let(::gradeColour) }
        return drawn.indices.mapNotNull { k ->
            val plateau = k > 0 && k < colours.size - 1 && colours[k] == colours[k - 1] && colours[k] == colours[k + 1]
            if (plateau) null else (distances[drawn[k]] - first) / span to colours[k]
        }
    }

    /** The y axis: the lowest recorded height, and a top at least [MIN_SPAN_M] above it. */
    val floorM: Double get() = floor(altitudeM.filterNotNull().min())
    val topM: Double get() = floorM + max(ceil(altitudeM.filterNotNull().max()) - floorM, MIN_SPAN_M)

    companion object {
        /** Without it every ride fills the box, and a flat valley loop draws exactly like a col. */
        const val MIN_SPAN_M = 200.0
    }
}

private const val MIN_TOLERANCE_M = 1.0
private const val TOLERANCE_OF_SPAN = 1.0 / 400
private const val MAX_STEP_M = 50.0
private const val MIN_STEPS = 40.0

/** What the profile draws for a plan's track, or null when there is too little altitude to draw a line. */
fun terrainOf(track: PlanTrack, reportedM: Double?): Terrain? {
    if (track.altitudeM.count { it != null } < 2) return null
    return terrainAlong(cumulativeDistances(track.coordinates, reportedM), track.altitudeM)
}

/**
 * What the profile draws for heights already measured against distance — metres from 0, ascending, one altitude each:
 * a stretch of a route matched against, or a ride's own barometer against the distance ridden.
 */
fun terrainAlong(distances: List<Double>, altitudeM: List<Double?>): Terrain? {
    val measured = altitudeM.filterNotNull()
    if (measured.size < 2) return null

    val totalM = distances.lastOrNull() ?: 0.0
    if (totalM <= 0) return null

    val tolerance = max(MIN_TOLERANCE_M, (measured.max() - measured.min()) * TOLERANCE_OF_SPAN)
    val grades = gradients(distances, altitudeM)
    val drawn = drawnIndices(distances, altitudeM, tolerance, min(MAX_STEP_M, totalM / MIN_STEPS))
    if (drawn.count { altitudeM[it] != null } < 2) return null

    return Terrain(
        distances = drawn.map { distances[it] },
        altitudeM = drawn.map { altitudeM[it] },
        gradients = drawn.map { grades[it] },
        trackIndex = drawn,
        totalM = totalM,
    )
}

/** The gradient ramp: absolute, dark green at −8% through to dark red at +15%. Colours as 0xRRGGBB. */
val GRADE: List<Pair<Double, Int>> = listOf(
    -8.0 to 0x0A6E4C,
    0.0 to 0x6FBF8E,
    4.0 to 0xE3C033,
    8.0 to 0xDD8531,
    11.5 to 0xC4382C,
    15.0 to 0x7D1A18,
)

/** The ramp's colour at [gradient], interpolated in sRGB between the two anchors it falls between. */
fun gradeColour(gradient: Double): Int {
    val last = GRADE.size - 1
    val (index, within) = when {
        gradient <= GRADE[0].first -> 0 to 0.0
        gradient >= GRADE[last].first -> last - 1 to 1.0
        else -> {
            val upper = (1..last).first { gradient <= GRADE[it].first }
            val lower = GRADE[upper - 1].first
            upper - 1 to (gradient - lower) / (GRADE[upper].first - lower)
        }
    }
    val from = GRADE[index].second
    val to = GRADE[index + 1].second
    fun channel(shift: Int): Int {
        val a = (from shr shift) and 0xFF
        val b = (to shr shift) and 0xFF
        return jsRound(a + (b - a) * within).toInt()
    }
    return (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
}
