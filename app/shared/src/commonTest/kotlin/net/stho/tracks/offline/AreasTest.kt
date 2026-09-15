package net.stho.tracks.offline

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.distanceM

class AreasTest {
    private val garmisch = Coordinate(47.4925, 11.0953)
    private val innsbruck = Coordinate(47.2692, 11.4041)

    @Test
    fun aTileIsNamedAsTheEngineNamesItsFile() {
        assertEquals("E10_N45", SegmentTile.of(garmisch).name)
        assertEquals("E5_N45", SegmentTile.of(Coordinate(47.5, 9.99)).name)
        assertEquals("E15_S35", SegmentTile.of(Coordinate(-33.9, 18.4)).name)
        assertEquals("W5_N40", SegmentTile.of(Coordinate(40.4, -3.7)).name)
        assertEquals("E0_N0", SegmentTile.of(Coordinate(0.0, 0.0)).name)
        assertEquals("W5_S5", SegmentTile.of(Coordinate(-0.0001, -0.0001)).name)
        assertEquals("E10_N45", SegmentTile.of(Coordinate(45.0, 10.0)).name)
        assertEquals("E175_N85", SegmentTile.of(Coordinate(90.0, 180.0)).name)
    }

    @Test
    fun aFileNameReadsBackAsItsTile() {
        for (tile in listOf(SegmentTile(10, 45), SegmentTile(-5, -35), SegmentTile(-180, -90))) {
            assertEquals(tile, SegmentTile.parse(tile.fileName))
        }
        assertNull(SegmentTile.parse("E10_N45.rd5.part"))
        assertNull(SegmentTile.parse("E11_N45.rd5"))
        assertNull(SegmentTile.parse("lookups.dat"))
    }

    @Test
    fun theAreaAroundGarmischNeedsTheTwoTilesMeasuredForIt() {
        val bounds = boundsAround(garmisch, AroundYou.RADIUS_M)
        assertEquals(setOf("E5_N45", "E10_N45"), SegmentTile.covering(bounds).map { it.name }.toSet())
    }

    @Test
    fun theBoxAroundAPointHoldsTheWholeCircle() {
        for (centre in listOf(garmisch, Coordinate(69.6, 18.9), Coordinate(-33.9, 18.4))) {
            val bounds = boundsAround(centre, 100_000.0)
            for (bearing in 0 until 360 step 5) {
                val edge = destination(centre, bearing.toDouble(), 100_000.0)
                // Within 1e-6° (~10 cm): due north and south land on the edge itself, give or take rounding.
                val e = 1e-6
                assertTrue(
                    edge.lat in bounds.south - e..bounds.north + e && edge.lon in bounds.west - e..bounds.east + e,
                    "100 km at $bearing° from $centre is $edge, outside $bounds",
                )
            }
            // And not by much more than it has to: north and south are the radius exactly.
            assertEquals(100_000.0, distanceM(centre, Coordinate(bounds.north, centre.lon)), 1.0)
        }
    }

    /** The point [distanceM] from [from] at [bearingDeg], on the sphere `distanceM` measures on. */
    private fun destination(from: Coordinate, bearingDeg: Double, distanceM: Double): Coordinate {
        val r = PI / 180
        val d = distanceM / 6_371_000.0
        val lat = asin(sin(from.lat * r) * cos(d) + cos(from.lat * r) * sin(d) * cos(bearingDeg * r))
        val lon = from.lon * r + atan2(sin(bearingDeg * r) * sin(d) * cos(from.lat * r), cos(d) - sin(from.lat * r) * sin(lat))
        return Coordinate(lat / r, lon / r)
    }

    @Test
    fun aPlanNearATilesEdgeBringsTheNextTileForADetour() {
        // ~15 km east of the E5/E10 edge: the line never crosses it, a detour around a closed pass might.
        val nearTheEdge = PlanLine("edge", listOf(Coordinate(47.5, 10.2), Coordinate(47.3, 10.25)))
        assertEquals(setOf(SegmentTile(5, 45), SegmentTile(10, 45)), OfflineNeeds.of(listOf(nearTheEdge), around = null).segments)

        val wellInside = PlanLine("inside", listOf(garmisch, innsbruck))
        assertEquals(setOf(SegmentTile(10, 45)), OfflineNeeds.of(listOf(wellInside), around = null).segments)
    }

    @Test
    fun theAreaAroundYouMovesOnlyOnceYouAreFarFromItsCentre() {
        assertEquals(garmisch, AroundYou.centre(null, garmisch))
        val near = Coordinate(47.6, 11.2)
        assertTrue(distanceM(garmisch, near) < AroundYou.RECENTRE_M)
        assertEquals(garmisch, AroundYou.centre(garmisch, near))
        assertEquals(innsbruck, AroundYou.centre(garmisch, innsbruck))
    }

    @Test
    fun needsAreTheUnionOfEveryPlanAndTheAreaAroundYou() {
        val toInnsbruck = PlanLine("a", listOf(garmisch, innsbruck))
        val intoSwitzerland = PlanLine("b", listOf(garmisch, Coordinate(47.3, 9.6)))
        val empty = PlanLine("c", emptyList())

        val needs = OfflineNeeds.of(listOf(toInnsbruck, intoSwitzerland, empty), around = garmisch)

        assertEquals(listOf("plan:a", "plan:b", "around"), needs.areas.map { it.key })
        assertEquals(setOf(SegmentTile(5, 45), SegmentTile(10, 45)), needs.segments)
        val a = needs.areas.first().bounds
        assertEquals(OfflineNeeds.PLAN_BUFFER_M, distanceM(Coordinate(a.north, garmisch.lon), garmisch), 1.0)

        val withoutPlanB = OfflineNeeds.of(listOf(toInnsbruck), around = null)
        assertEquals(listOf("plan:a"), withoutPlanB.areas.map { it.key })
        assertEquals(setOf(SegmentTile(10, 45)), withoutPlanB.segments)
        assertEquals(OfflineNeeds(emptyList(), emptySet()), OfflineNeeds.of(emptyList(), around = null))
    }
}
