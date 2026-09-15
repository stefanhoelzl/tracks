package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import kotlin.math.max

/*
 * A plan's legs, from `packages/routing/src/router.ts`.
 *
 * A leg runs from one POI to the next, with whatever shaping points fell inside it. That is what makes an edit cheap:
 * moving one waypoint invalidates the one or two legs around it and nothing else.
 */

/** One POI-to-POI stretch as the router answered it. */
sealed interface Leg {
    val from: Waypoint
    val to: Waypoint

    /** What the map draws for it. */
    val coordinates: List<Coordinate>
}

data class RoutedLeg(
    override val from: Waypoint,
    override val to: Waypoint,
    override val coordinates: List<Coordinate>,
    /** Height above sea level per point, aligned by index with [coordinates]. */
    val altitudeM: List<Double>,
    val distanceM: Double,
    /** BRouter's `filtered ascend`, the figure that agrees with what Strava says about the same hill. */
    val ascentM: Double,
    val descentM: Double,
    val durationS: Double,
) : Leg

/** A stretch the engine could not connect: drawn as a still dash between its ends, named, never hidden. */
data class FailedLeg(
    override val from: Waypoint,
    override val to: Waypoint,
    val reason: String,
) : Leg {
    override val coordinates: List<Coordinate>
        get() = listOf(Coordinate(from.lat, from.lon), Coordinate(to.lat, to.lon))
}

/**
 * Split a waypoint sequence into the POI-to-POI stretches that become legs. Leading and trailing shaping points have no
 * leg to belong to and are dropped.
 */
fun stretches(waypoints: List<Waypoint>): List<List<Waypoint>> {
    val out = ArrayList<List<Waypoint>>()
    var current: MutableList<Waypoint>? = null

    for (waypoint in waypoints) {
        if (waypoint.kind == WaypointKind.Poi) {
            current?.let {
                it.add(waypoint)
                out.add(it)
            }
            current = mutableListOf(waypoint)
        } else {
            current?.add(waypoint)
        }
    }

    return out
}

/** What a leg was routed for: its waypoints' positions and kinds, and the profile. Names do not move a line. */
internal fun legKey(stretch: List<Waypoint>, profile: Profile): String =
    stretch.joinToString("|", prefix = "${profile.wire}|") { "${it.lat},${it.lon},${it.kind}" }

/** The same leg, between ends that may have been renamed since it was routed. */
internal fun Leg.withEnds(from: Waypoint, to: Waypoint): Leg = when (this) {
    is RoutedLeg -> copy(from = from, to = to)
    is FailedLeg -> copy(from = from, to = to)
}

/**
 * Descent, from ascent and the two ends: over any path `descent = ascent - (end - start)`, so the second readout is
 * derived from the first and the two cannot contradict each other.
 */
fun descentOf(ascentM: Double, altitudeM: List<Double>): Double {
    val start = altitudeM.firstOrNull() ?: return 0.0
    return max(0.0, ascentM - (altitudeM.last() - start))
}
