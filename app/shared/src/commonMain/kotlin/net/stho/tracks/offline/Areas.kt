package net.stho.tracks.offline

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.distanceM

/*
 * What the phone keeps offline, as places (M13). The app decides it, not the rider: the area of every stored plan, and the
 * 100 km around you. Here it is geometry only, so its rules are tested on every target; the map packs and the downloads
 * that fill these areas are elsewhere.
 */

/** Metres in one degree of latitude, on the sphere `distanceM` measures on. */
private const val METRES_PER_DEGREE = 6_371_000.0 * PI / 180

/** A box of degrees. It never crosses the antimeridian: nothing this app rides is near it. */
data class Bounds(val south: Double, val west: Double, val north: Double, val east: Double) {
    init {
        require(south <= north && west <= east) { "bounds must not be inverted: $this" }
    }

    /** This box, grown to the next multiples of [step] degrees on every side; [step] divides a degree evenly. */
    fun outward(step: Double): Bounds {
        // Counted in whole steps and divided, never multiplied back by the step: 107 / 10.0 is 10.7, 107 * 0.1 is not.
        val perDegree = (1 / step).roundToInt()
        fun down(v: Double) = floor(v * perDegree + 1e-9) / perDegree
        fun up(v: Double) = -floor(-v * perDegree + 1e-9) / perDegree
        return Bounds(max(-89.0, down(south)), max(-180.0, down(west)), min(89.0, up(north)), min(180.0, up(east)))
    }
}

/** The box that holds the whole circle of [radiusM] around [centre]. */
fun boundsAround(centre: Coordinate, radiusM: Double): Bounds = boundsOf(listOf(centre), radiusM)

/**
 * The box around [points], grown by [bufferM] on every side.
 *
 * East and west grow by the degrees [bufferM] spans at the box's edge furthest from the equator, where a degree of
 * longitude is shortest, so the buffer is at least [bufferM] everywhere along it.
 */
fun boundsOf(points: List<Coordinate>, bufferM: Double): Bounds {
    require(points.isNotEmpty()) { "a box needs at least one point" }
    val dLat = bufferM / METRES_PER_DEGREE
    val south = max(-89.0, points.minOf { it.lat } - dLat)
    val north = min(89.0, points.maxOf { it.lat } + dLat)
    val dLon = bufferM / (METRES_PER_DEGREE * cos(max(abs(south), abs(north)) * PI / 180))
    return Bounds(south, max(-180.0, points.minOf { it.lon } - dLon), north, min(180.0, points.maxOf { it.lon } + dLon))
}

/**
 * One of BRouter's segment files: the 5° × 5° square whose south-west corner is at [lon], [lat].
 *
 * Routing needs whole files, which is why they dominate what an area costs: around Garmisch, `E5_N45` and `E10_N45` are
 * ~450 MB of an area's ~1 GB.
 */
data class SegmentTile(val lon: Int, val lat: Int) {
    init {
        require(lon % 5 == 0 && lat % 5 == 0 && lon in -180..175 && lat in -90..85) { "not a segment tile's corner: $lon, $lat" }
    }

    /** As the engine names it (`NodesCache.fileForSegment`): `E10_N45`, `W5_S35`. */
    val name: String get() = (if (lon < 0) "W${-lon}" else "E$lon") + "_" + (if (lat < 0) "S${-lat}" else "N$lat")

    val fileName: String get() = "$name.rd5"

    companion object {
        fun of(at: Coordinate): SegmentTile = SegmentTile(corner(at.lon, 180), corner(at.lat, 90))

        /** Every tile [bounds] reaches into. */
        fun covering(bounds: Bounds): Set<SegmentTile> {
            val southWest = of(Coordinate(bounds.south, bounds.west))
            val northEast = of(Coordinate(bounds.north, bounds.east))
            return buildSet {
                for (lon in southWest.lon..northEast.lon step 5) for (lat in southWest.lat..northEast.lat step 5) add(SegmentTile(lon, lat))
            }
        }

        /** The tile a file in the segment directory is, or null for any other file. */
        fun parse(fileName: String): SegmentTile? {
            val match = FILE_NAME.matchEntire(fileName) ?: return null
            val (ew, lon, ns, lat) = match.destructured
            return runCatching {
                SegmentTile(if (ew == "W") -lon.toInt() else lon.toInt(), if (ns == "S") -lat.toInt() else lat.toInt())
            }.getOrNull()
        }

        private val FILE_NAME = Regex("""([EW])(\d+)_([NS])(\d+)\.rd5""")
    }
}

/** Whole degrees counted from -[offset], down to a multiple of five: the engine's arithmetic, on the tile's own edge too. */
private fun corner(degrees: Double, offset: Int): Int {
    val counted = min(floor(degrees + offset).toInt(), 2 * offset - 1)
    return counted - counted % 5 - offset
}

/**
 * The area around you: 100 km at full detail, centred where you were when it last moved.
 *
 * It moves only once you are [RECENTRE_M] from its centre, so at least 75 km stay covered in every direction, and a ride
 * does not start a download every few hundred metres.
 */
object AroundYou {
    const val RADIUS_M = 100_000.0
    const val RECENTRE_M = 25_000.0

    fun centre(current: Coordinate?, at: Coordinate): Coordinate =
        if (current == null || distanceM(current, at) > RECENTRE_M) at else current
}

/** A stored plan, as offline data sees it: its id, and every point of its line — waypoints and routed legs. */
data class PlanLine(val id: String, val points: List<Coordinate>)

/** A place the map keeps offline, one offline pack. [key] names what it is for, and stays the same while that does. */
data class MapArea(val key: String, val bounds: Bounds)

/**
 * Everything the phone should hold offline right now: the map's areas, and the segment tiles routing needs.
 *
 * A plan's area is the box of its line grown by [PLAN_BUFFER_M], and it brings both a map and the segment tiles it
 * reaches into: a re-plan around a closed pass can leave the line by tens of kilometres, and needs something to route on
 * there, not only something to look at — also where the detour crosses into the next 5° tile. The area around you brings
 * the same within [AroundYou.RADIUS_M]. Two needs of one tile are one tile: a set, not a sum, so deleting a plan releases
 * only what nothing else needs.
 */
data class OfflineNeeds(val areas: List<MapArea>, val segments: Set<SegmentTile>) {
    companion object {
        const val PLAN_BUFFER_M = 25_000.0
        const val AROUND_KEY = "around"

        fun planKey(id: String) = "plan:$id"

        /**
         * A plan's box is rounded outward to this many degrees: a leg that routes, or an edit that moves a stop by a
         * few hundred metres, leaves the area as it was, and its pack is not made again.
         */
        const val PLAN_GRID_DEG = 0.1

        fun of(plans: List<PlanLine>, around: Coordinate?): OfflineNeeds {
            val areas = plans.filter { it.points.isNotEmpty() }.map { MapArea(planKey(it.id), boundsOf(it.points, PLAN_BUFFER_M).outward(PLAN_GRID_DEG)) } +
                listOfNotNull(around?.let { MapArea(AROUND_KEY, boundsAround(it, AroundYou.RADIUS_M)) })
            return OfflineNeeds(areas, areas.flatMap { SegmentTile.covering(it.bounds) }.toSet())
        }
    }
}
