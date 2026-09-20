package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/*
 * The elevation profile's arithmetic, from `packages/web/src/lib/profile.ts`: the axis a ride is drawn against, the
 * point a finger landed on, and the figures under the bar. Pinned by `profile.json`.
 *
 * The painting and the gestures are each platform's own. These are not: a profile that answers "how much is left" with
 * a different number here than in the browser is two profiles.
 */

/** A labelled axis: where the gridlines are, and what the ends of the scale became. */
data class Axis(val min: Double, val max: Double, val step: Double, val values: List<Double>)

/**
 * The steps a height axis is allowed to use: round numbers a person reads without doing arithmetic, each a 1, 2 or 5
 * of its decade so consecutive gridlines stay easy to count between.
 */
private val HEIGHT_STEPS = listOf(5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 5000.0)

/** The same, in metres, for distance along the track. */
private val DISTANCE_STEPS = listOf(100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10_000.0, 20_000.0, 50_000.0, 100_000.0)

/** At most this many gaps between gridlines, so an axis carries three to five labels. */
private const val MOST_GAPS = 4

private fun stepFor(span: Double, steps: List<Double>, mostGaps: Int): Double =
    steps.firstOrNull { span / it <= mostGaps } ?: steps.last()

/**
 * The height axis for a profile between [lowM] and [highM], at least [minSpanM] tall.
 *
 * The minimum span survived the arrival of gridlines, and is snapped out to the step: without it a flat valley loop
 * fills the box and draws exactly like a col, and with it the labels would read 612 and 812.
 */
fun heightAxis(lowM: Double, highM: Double, minSpanM: Double): Axis {
    val span = max(highM - lowM, minSpanM)
    val step = stepFor(span, HEIGHT_STEPS, MOST_GAPS)

    val low = floor(lowM / step) * step
    val reach = max(highM, low + minSpanM)
    val high = max(ceil(reach / step) * step, low + step)

    return Axis(low, high, step, ticks(low, high, step))
}

/**
 * The distance axis for a track [totalM] long: it starts at zero, and the last gridline is the last round number that
 * fits. The total itself is drawn at the end of the axis rather than left to a label hanging past the panel.
 */
fun distanceAxis(totalM: Double): Axis {
    val step = stepFor(totalM, DISTANCE_STEPS, MOST_GAPS + 1)
    val high = floor(totalM / step) * step
    return Axis(0.0, high, step, ticks(0.0, high, step))
}

/** Counted rather than accumulated, so a small step cannot drift the last value off its label. */
private fun ticks(min: Double, max: Double, step: Double): List<Double> {
    val out = ArrayList<Double>()
    var at = 0
    while (min + at * step <= max + step / 1000) {
        out.add(min + at * step)
        at++
    }
    return out
}

/** A stretch between two bars, in metres along the track. */
data class Range(val fromM: Double, val toM: Double)

/** How far a stretch of track runs, and what it does with its height. */
data class Stats(val distanceM: Double, val ascentM: Double, val descentM: Double)

/**
 * The height [alongM] metres in, interpolated between the drawn points either side.
 *
 * Null inside a dropout, and at either end of one: a height half way across a gap in the data is invented, and the
 * profile draws a gap there for the same reason.
 */
fun altitudeAt(distances: List<Double>, altitudeM: List<Double?>, alongM: Double): Double? {
    if (distances.isEmpty()) return null
    if (alongM <= distances.first()) return altitudeM.firstOrNull()
    val after = distances.indexOfFirst { it >= alongM }
    if (after < 0) return altitudeM.lastOrNull()

    val before = altitudeM[after - 1] ?: return null
    val beyond = altitudeM[after] ?: return null

    val span = distances[after] - distances[after - 1]
    if (span <= 0) return beyond
    return before + (alongM - distances[after - 1]) / span * (beyond - before)
}

/**
 * What the track does between [fromM] and [toM]: how far, how much up, how much down.
 *
 * Measured over the points the profile drew rather than over the track, because those are the points the picture is
 * made of. Both ends are interpolated, so dragging a bar changes the numbers smoothly. A dropout contributes nothing:
 * the climb across a gap in the data is not known, and counting the jump between the heights either side would invent
 * a wall.
 */
fun statsBetween(distances: List<Double>, altitudeM: List<Double?>, fromM: Double, toM: Double): Stats {
    val start = min(fromM, toM)
    val end = max(fromM, toM)
    if (distances.isEmpty() || end <= start) return Stats(0.0, 0.0, 0.0)

    var ascentM = 0.0
    var descentM = 0.0
    var last = altitudeAt(distances, altitudeM, start)

    for (at in distances.indices) {
        val where = distances[at]
        if (where <= start) continue
        if (where >= end) break
        val height = altitudeM[at]
        if (height != null && last != null) {
            val change = height - last
            if (change > 0) ascentM += change else descentM -= change
        }
        last = height
    }

    val finish = altitudeAt(distances, altitudeM, end)
    if (finish != null && last != null) {
        val change = finish - last
        if (change > 0) ascentM += change else descentM -= change
    }

    return Stats(end - start, ascentM, descentM)
}

/** A profile cut in two at a point: what is behind it, and what is still ahead. */
data class Split(val done: Stats, val toCome: Stats)

/**
 * The track either side of [atM] — the flanking row under every profile.
 *
 * Riding, [atM] is where you are and the two halves are literally done and to come. Planning there is no you, so it is
 * wherever the bar was put, and *done* means *by the time you reach the bar*.
 */
fun splitAt(distances: List<Double>, altitudeM: List<Double?>, atM: Double): Split {
    val totalM = distances.lastOrNull() ?: 0.0
    val at = atM.coerceIn(0.0, totalM)
    return Split(
        done = statsBetween(distances, altitudeM, 0.0, at),
        toCome = statsBetween(distances, altitudeM, at, totalM),
    )
}

/**
 * Where a pointer at [fraction] across the plot landed, in metres along the track.
 *
 * A multiplication, shared so that the two platforms cannot disagree about whether the edges are inclusive — the kind
 * of difference that makes a bar unreachable at one end of a track on one platform only.
 */
fun alongAt(totalM: Double, fraction: Double): Double = fraction.coerceIn(0.0, 1.0) * totalM

/** The drawn point nearest [alongM]; ties go to the later one, as in the web. */
fun nearestDrawn(distances: List<Double>, alongM: Double): Int = nearestInSorted(distances, alongM)

/**
 * The points of a track between [fromM] and [toM] along it, both ends interpolated.
 *
 * What the map draws when a stretch is selected on the profile: the stretch keeps its colour and the track either side
 * of it is held back, so the two pictures agree about which piece of the ride is being talked about. Interpolated ends
 * rather than the nearest recorded points, because a bar dragged half way between two of them should move the
 * highlight rather than snap it.
 */
fun sliceBetween(points: List<Coordinate>, along: List<Double>, fromM: Double, toM: Double): List<Coordinate> {
    val start = min(fromM, toM)
    val end = max(fromM, toM)
    if (points.size < 2 || end <= start) return emptyList()

    fun at(alongM: Double): Coordinate {
        val after = along.indexOfFirst { it >= alongM }
        if (after <= 0) return points[if (after < 0) points.size - 1 else 0]
        val a = points[after - 1]
        val b = points[after]
        val span = along[after] - along[after - 1]
        val t = if (span <= 0) 1.0 else (alongM - along[after - 1]) / span
        return Coordinate(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)
    }

    val out = ArrayList<Coordinate>()
    out += at(start)
    for (i in along.indices) {
        if (along[i] <= start || along[i] >= end) continue
        out += points[i]
    }
    out += at(end)
    return out
}
