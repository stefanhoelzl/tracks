package net.stho.tracks.riding

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Terrain
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.legGeometries
import net.stho.tracks.plan.sliceBetween
import net.stho.tracks.plan.terrainAlong
import net.stho.tracks.recording.Climb
import net.stho.tracks.sensors.distanceM

/**
 * How much further than the nearest stretch of the route another may be and still count as just as near: a road's
 * width and a GPS's wander. Where two stretches are that close — an out-and-back's two passes of one road, a figure of
 * eight's crossing — which one you are on is decided by where you were.
 */
const val SAME_DISTANCE_M = 30.0

/** A distance and a climb along the route, and whether a leg in between is not routed, so they are short by it. */
data class Reading(val distanceM: Double, val ascentM: Double, val incomplete: Boolean)

/** Where a position was matched on the route: [alongM] metres from its start, at [at], [offM] from where you are. */
data class Position(val alongM: Double, val at: Coordinate, val offM: Double)

/** What the riding screen reads at a [Position]. */
data class Progress(
    val alongM: Double,
    /** The leg the position is on. */
    val leg: Int,
    /** The ordinal of the next stop, 1 for the first after the start; null once past the finish. */
    val nextStop: Int?,
    val toFinish: Reading,
    /** From here to each stop still ahead, the next stop first. */
    val ahead: List<Reading>,
)

/**
 * A plan's legs laid end to end, as the riding screen measures along them.
 *
 * Every point has a distance along the route. A routed leg's distances are scaled so the leg is as long as the router
 * reported it, and its climb so it is the router's filtered ascent, shaped along the leg by the leg's own altitudes: at
 * the start of a leg the readouts are the stop list's numbers exactly. A leg that is not routed — still routing, failed
 * or without data — is its straight line: it is drawn and matched against at that length, counts for nothing in a
 * total, and makes every total across it [Reading.incomplete].
 */
class Route(waypoints: List<Waypoint>, legs: List<Leg?>) {
    private val points = ArrayList<Coordinate>()

    /** Metres along the route, per point. */
    private val along = ArrayList<Double>()

    /** Metres counted in totals, per point: [along] less every leg that is not routed. */
    private val counted = ArrayList<Double>()
    private val climbed = ArrayList<Double>()
    private val altitudes = ArrayList<Double?>()

    /** Where each leg starts in [points], and one past the last point for the end. */
    private val firstPoint = ArrayList<Int>()
    private val routed = ArrayList<Boolean>()

    /** Metres along the route at each stop: the start, the end of every leg. */
    val stops: List<Double>

    val totalM: Double get() = along.lastOrNull() ?: 0.0

    val legCount: Int get() = routed.size

    init {
        val geometries = legGeometries(waypoints, legs)
        val stopsAt = ArrayList<Double>()
        for ((index, geometry) in geometries.withIndex()) {
            val leg = legs.getOrNull(index) as? RoutedLeg
            val startAlong = along.lastOrNull() ?: 0.0
            val startCounted = counted.lastOrNull() ?: 0.0
            val startClimbed = climbed.lastOrNull() ?: 0.0
            stopsAt += startAlong
            firstPoint += points.size
            routed += leg != null

            // The leg's own measure first, then scaled to what the router said about it.
            val raw = DoubleArray(geometry.size)
            for (i in 1 until geometry.size) raw[i] = raw[i - 1] + distanceM(geometry[i - 1], geometry[i])
            val length = raw.lastOrNull() ?: 0.0
            val scale = if (leg != null && length > 0) leg.distanceM / length else 1.0

            val rise = DoubleArray(geometry.size)
            if (leg != null) {
                val climb = Climb()
                for (i in geometry.indices) {
                    leg.altitudeM.getOrNull(i)?.let(climb::add)
                    rise[i] = climb.gainM
                }
            }
            val totalRise = rise.lastOrNull() ?: 0.0

            for (i in geometry.indices) {
                points += geometry[i]
                along += startAlong + raw[i] * scale
                counted += startCounted + if (leg != null) raw[i] * scale else 0.0
                climbed += startClimbed + when {
                    leg == null -> 0.0
                    totalRise > 0 -> rise[i] / totalRise * leg.ascentM
                    // A leg the router says climbs, over altitudes that do not: its climb spread by distance.
                    length > 0 -> raw[i] / length * leg.ascentM
                    else -> 0.0
                }
                altitudes += if (leg != null) leg.altitudeM.getOrNull(i) else null
            }
        }
        if (geometries.isNotEmpty()) stopsAt += totalM
        firstPoint += points.size
        stops = stopsAt
    }

    /**
     * The nearest point on the route to [at]. Where more than one stretch of the route is about as near — within
     * [SAME_DISTANCE_M] of the nearest — the one nearest along the route to [previousM] wins, when there is one; and
     * of passes about as far along from it as each other, one ahead of it, the nearer first.
     * Null for a route with nothing to match against.
     */
    fun locate(at: Coordinate, previousM: Double? = null): Position? {
        if (points.size < 2) return null
        val squash = cos(at.lat * RAD)
        val px = at.lon * squash
        val segments = points.size - 1
        val off = DoubleArray(segments)
        val fraction = DoubleArray(segments)
        for (i in 0 until segments) {
            val a = points[i]
            val b = points[i + 1]
            val ax = a.lon * squash
            val dx = b.lon * squash - ax
            val dy = b.lat - a.lat
            val span = dx * dx + dy * dy
            val t = if (span == 0.0) 0.0 else max(0.0, min(1.0, ((px - ax) * dx + (at.lat - a.lat) * dy) / span))
            val ox = px - (ax + t * dx)
            val oy = at.lat - (a.lat + t * dy)
            off[i] = sqrt(ox * ox + oy * oy) * M_PER_DEG
            fraction[i] = t
        }
        val nearest = off.min()

        // Each pass of the route by you offers the point where it comes nearest: a stretch nearer than the stretches on
        // either side of it. Only passes about as near as the nearest are candidates.
        val passes = (0 until segments).filter { i ->
            off[i] <= nearest + SAME_DISTANCE_M && (i == 0 || off[i] <= off[i - 1]) && (i == segments - 1 || off[i] <= off[i + 1])
        }

        fun alongAt(segment: Int) = along[segment] + fraction[segment] * (along[segment + 1] - along[segment])
        val chosen = if (previousM == null) {
            passes.minBy { off[it] }
        } else {
            // At a turnaround both passes are about as far along from where you were — on a road ridden both ways, as
            // near as each other too. The way on wins then: coming back from a turnaround is going on, not back.
            val closest = passes.minOf { abs(alongAt(it) - previousM) }
            val tied = passes.filter { abs(alongAt(it) - previousM) <= closest + SAME_DISTANCE_M }
            (tied.filter { alongAt(it) >= previousM }.ifEmpty { tied }).minBy { off[it] }
        }
        val a = points[chosen]
        val b = points[chosen + 1]
        val t = fraction[chosen]
        return Position(
            alongM = alongAt(chosen),
            at = Coordinate(a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon)),
            offM = off[chosen],
        )
    }

    /** From [fromM] to [toM] along the route, which must not be before it. */
    fun between(fromM: Double, toM: Double): Reading {
        val incomplete = (0 until legCount).any { !routed[it] && stops[it] < toM && stops[it + 1] > fromM }
        return Reading(
            distanceM = interpolate(counted, toM) - interpolate(counted, fromM),
            ascentM = interpolate(climbed, toM) - interpolate(climbed, fromM),
            incomplete = incomplete,
        )
    }

    /** What the screen reads at [alongM]. */
    fun progress(alongM: Double): Progress {
        val here = alongM.coerceIn(0.0, totalM)
        val leg = (0 until legCount).lastOrNull { stops[it] <= here } ?: 0
        val next = (1 until stops.size).firstOrNull { stops[it] > here }
        return Progress(
            alongM = here,
            leg = leg,
            nextStop = next,
            toFinish = between(here, totalM),
            ahead = next?.let { first -> (first until stops.size).map { between(here, stops[it]) } } ?: emptyList(),
        )
    }

    /** The point [alongM] metres along the route, between the points on either side; null for a route with none. */
    fun pointAt(alongM: Double): Coordinate? {
        if (points.isEmpty()) return null
        val here = alongM.coerceIn(0.0, totalM)
        val after = along.indexOfFirst { it >= here }
        if (after <= 0) return points[if (after < 0) points.size - 1 else 0]
        val a = points[after - 1]
        val b = points[after]
        val span = along[after] - along[after - 1]
        val t = if (span <= 0) 1.0 else (here - along[after - 1]) / span
        return Coordinate(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)
    }

    /** The whole route's terrain, measured along it: a leg that is not routed is a gap as long as its straight line. */
    fun terrain(): Terrain? = terrainAlong(along, altitudes)

    /**
     * The route's own points between [fromM] and [toM], both ends interpolated: a stretch selected on the profile, as
     * a line for the map to draw over the plan it is part of.
     */
    fun lineBetween(fromM: Double, toM: Double): List<Coordinate> = sliceBetween(points, along, fromM, toM)

    /** One leg's terrain, measured from the leg's start. */
    fun legTerrain(leg: Int): Terrain? {
        val from = firstPoint[leg]
        val to = firstPoint[leg + 1]
        val start = along[from]
        return terrainAlong(along.subList(from, to).map { it - start }, altitudes.subList(from, to))
    }

    /**
     * The terrain from [fromM] to [toM] along the route, measured from [fromM]: what lies between you and a stop ahead.
     * Its ends are where the two fall between points, so it is exactly as long as the stretch.
     */
    fun terrainBetween(fromM: Double, toM: Double): Terrain? {
        val from = fromM.coerceIn(0.0, totalM)
        val to = toM.coerceIn(from, totalM)
        if (to <= from) return null
        val distances = ArrayList<Double>()
        val heights = ArrayList<Double?>()
        distances += 0.0
        heights += altitudeAt(from)
        for (i in along.indices) {
            if (along[i] <= from || along[i] >= to) continue
            distances += along[i] - from
            heights += altitudes[i]
        }
        distances += to - from
        heights += altitudeAt(to)
        return terrainAlong(distances, heights)
    }

    /** The height [alongM] metres along, between the points on either side; null where either has none. */
    private fun altitudeAt(alongM: Double): Double? {
        if (along.isEmpty()) return null
        val after = along.indexOfFirst { it >= alongM }
        if (after <= 0) return altitudes.getOrNull(if (after < 0) along.size - 1 else 0)
        val a = altitudes[after - 1] ?: return null
        val b = altitudes[after] ?: return null
        val span = along[after] - along[after - 1]
        return if (span <= 0) b else a + (alongM - along[after - 1]) / span * (b - a)
    }

    /** Linear between the points on either side of [alongM]. */
    private fun interpolate(values: List<Double>, alongM: Double): Double {
        if (values.isEmpty()) return 0.0
        if (alongM <= along.first()) return values.first()
        if (alongM >= along.last()) return values.last()
        var low = 0
        var high = along.size - 1
        while (high - low > 1) {
            val mid = (low + high) ushr 1
            if (along[mid] <= alongM) low = mid else high = mid
        }
        val span = along[high] - along[low]
        if (span <= 0) return values[high]
        return values[low] + (alongM - along[low]) / span * (values[high] - values[low])
    }

    private companion object {
        const val RAD = PI / 180
        const val M_PER_DEG = 111_320.0
    }
}

/**
 * A ride along a [Route]: each fix matched to the nearest point, where you were deciding between passes that are
 * equally near.
 *
 * When the route changes under you — a detour, an edit, a leg that finished routing — the point you were matched to
 * is matched again on the new route, from where it was along the old one: a stretch before the edit is the same
 * distance along, and one after it close enough to pick the right pass.
 */
class Follower(route: Route) {
    var route: Route = route
        private set

    private var last: Position? = null

    /** Where [at] is along the route, or null while the route has nothing to match against. */
    fun follow(at: Coordinate): Progress? {
        val position = route.locate(at, last?.alongM) ?: return null
        last = position
        return route.progress(position.alongM)
    }

    fun reroute(next: Route) {
        last = last?.let { next.locate(it.at, it.alongM) }
        route = next
    }

    /** Where the last fix was matched, read again on the current route. */
    fun progress(): Progress? = last?.let { route.progress(it.alongM) }
}
