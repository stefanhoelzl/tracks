package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Where on a path a point is closest: [position] is the segment index plus the fraction along it. */
internal data class PathHit(val position: Double, val distanceM: Double)

private const val RAD = PI / 180
private const val M_PER_DEG = 111_320.0

/**
 * The nearest point on a path, from `packages/web/src/lib/geo.ts`.
 *
 * Flat-earth, with longitude squashed by the cosine of the point's latitude: exact enough to choose between legs and
 * to order shaping points along one, and cheap enough to run for every leg on every tap.
 */
internal fun nearestOnPath(coordinates: List<Coordinate>, lon: Double, lat: Double): PathHit {
    val squash = cos(lat * RAD)
    val px = lon * squash
    var best = PathHit(0.0, Double.POSITIVE_INFINITY)

    for (i in 0 until coordinates.size - 1) {
        val from = coordinates[i]
        val to = coordinates[i + 1]

        val ax = from.lon * squash
        val ay = from.lat
        val dx = to.lon * squash - ax
        val dy = to.lat - ay

        val span = dx * dx + dy * dy
        val t = if (span == 0.0) 0.0 else max(0.0, min(1.0, ((px - ax) * dx + (lat - ay) * dy) / span))

        val offX = px - (ax + t * dx)
        val offY = lat - (ay + t * dy)
        val distanceM = sqrt(offX * offX + offY * offY) * M_PER_DEG

        if (distanceM < best.distanceM) best = PathHit(i + t, distanceM)
    }

    return best
}
