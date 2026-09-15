package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import kotlin.math.max
import kotlin.math.min

/*
 * A plan's legs read as one track, from `packages/web/src/lib/plan-track.ts`: what the map draws, the numbers above the
 * stop list, and what each row reads. Pinned by `plan-edit.json`.
 */

/**
 * What each leg looks like on the map, routed or not. A leg with no answer yet is the straight run through its own
 * waypoints — what the map draws, and what a tap is measured against.
 */
fun legGeometries(waypoints: List<Waypoint>, legs: List<Leg?>): List<List<Coordinate>> =
    stretches(waypoints).mapIndexed { index, stretch ->
        legs.getOrNull(index)?.coordinates ?: stretch.map { Coordinate(it.lat, it.lon) }
    }

data class PlanTotals(
    val distanceM: Double = 0.0,
    val ascentM: Double = 0.0,
    val descentM: Double = 0.0,
    val durationS: Double = 0.0,
    /** A leg failed or is still routing, so these numbers are missing part of the plan — and say so. */
    val incomplete: Boolean = false,
)

private operator fun PlanTotals.plus(leg: RoutedLeg) = copy(
    distanceM = distanceM + leg.distanceM,
    ascentM = ascentM + leg.ascentM,
    descentM = descentM + leg.descentM,
    durationS = durationS + leg.durationS,
)

fun planTotals(legs: List<Leg?>): PlanTotals =
    legs.fold(PlanTotals()) { total, leg -> if (leg is RoutedLeg) total + leg else total.copy(incomplete = true) }

/** Every leg end to end, for the elevation profile. [altitudeM] is null along a beeline: a gap, not a flat line. */
data class PlanTrack(val coordinates: List<Coordinate>, val altitudeM: List<Double?>)

fun planTrack(legs: List<Leg?>): PlanTrack {
    val coordinates = ArrayList<Coordinate>()
    val altitudeM = ArrayList<Double?>()

    for (leg in legs) {
        if (leg == null) continue
        // Legs meet at a POI, so each after the first drops the point the previous one ended on.
        val skip = if (coordinates.isNotEmpty()) 1 else 0
        for (index in skip until leg.coordinates.size) {
            coordinates.add(leg.coordinates[index])
            altitudeM.add(if (leg is RoutedLeg) leg.altitudeM.getOrNull(index) else null)
        }
    }

    return PlanTrack(coordinates, altitudeM)
}

/** Distance and ascent to the end of each leg. `incomplete` is sticky: once a leg is missed, every total after it is short. */
fun cumulative(legs: List<Leg?>): List<PlanTotals> {
    var total = PlanTotals()
    return legs.map { leg ->
        total = if (leg is RoutedLeg) total + leg else total.copy(incomplete = true)
        total
    }
}

data class StopReading(
    /** Signed: negative for a stop before the one being measured from. */
    val distanceM: Double,
    val ascentM: Double,
    /** A leg between this stop and the base did not route, so the gap is unknown. */
    val incomplete: Boolean,
)

/** What each stop reads, measured from stop [base]. The base row itself reads nothing. */
fun readingsFrom(legs: List<Leg?>, base: Int): List<StopReading?> {
    val running = cumulative(legs)

    fun at(stop: Int): PlanTotals =
        if (stop <= 0) PlanTotals() else running.getOrNull(stop - 1) ?: PlanTotals(incomplete = true)

    val anchor = at(base)

    return List(running.size + 1) { stop ->
        if (stop == base) {
            null
        } else {
            val here = at(stop)
            StopReading(
                distanceM = here.distanceM - anchor.distanceM,
                ascentM = here.ascentM - anchor.ascentM,
                incomplete = at(max(stop, base)).incomplete,
            )
        }
    }
}

data class Bounds(val west: Double, val south: Double, val east: Double, val north: Double)

/** Everything the plan covers — the waypoints and the drawn geometry, since neither contains the other. */
fun planBounds(waypoints: List<Waypoint>, legs: List<Leg?>): Bounds? {
    var west = Double.POSITIVE_INFINITY
    var south = Double.POSITIVE_INFINITY
    var east = Double.NEGATIVE_INFINITY
    var north = Double.NEGATIVE_INFINITY

    fun extend(lon: Double, lat: Double) {
        west = min(west, lon)
        east = max(east, lon)
        south = min(south, lat)
        north = max(north, lat)
    }

    for (waypoint in waypoints) extend(waypoint.lon, waypoint.lat)
    for (leg in legGeometries(waypoints, legs)) {
        for (point in leg) extend(point.lon, point.lat)
    }

    return if (west.isFinite()) Bounds(west, south, east, north) else null
}
