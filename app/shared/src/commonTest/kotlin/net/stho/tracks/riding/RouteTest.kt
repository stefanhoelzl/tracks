package net.stho.tracks.riding

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.planTotals
import net.stho.tracks.plan.readingsFrom

class RouteTest {
    private val metre = 1.0 / (6_371_000.0 * PI / 180.0)

    /** A place [northM] and [eastM] metres from a point near Garmisch. */
    private fun at(northM: Double, eastM: Double = 0.0) =
        Coordinate(47.0 + northM * metre, 11.0 + eastM * metre / cos(47.0 * PI / 180))

    private fun stop(point: Coordinate) = Waypoint(point.lat, point.lon, WaypointKind.Poi, null)

    /** A leg through [path], a point every 10 m, climbing [climbM] evenly — as long and as steep as it says. */
    private fun leg(path: List<Coordinate>, climbM: Double = 0.0, reportedM: Double? = null): RoutedLeg {
        val points = path.zipWithNext().flatMap { (a, b) ->
            val steps = maxOf(1, (net.stho.tracks.sensors.distanceM(a, b) / 10).toInt())
            (0 until steps).map { Coordinate(a.lat + (b.lat - a.lat) * it / steps, a.lon + (b.lon - a.lon) * it / steps) }
        } + path.last()
        val length = points.zipWithNext().sumOf { (a, b) -> net.stho.tracks.sensors.distanceM(a, b) }
        return RoutedLeg(
            from = stop(path.first()),
            to = stop(path.last()),
            coordinates = points,
            altitudeM = points.indices.map { 700 + climbM * it / (points.size - 1) },
            distanceM = reportedM ?: length,
            ascentM = climbM,
            descentM = 0.0,
            durationS = 0.0,
        )
    }

    private fun near(expected: Double, actual: Double, tolerance: Double = 2.0, message: String = "") =
        assertTrue(abs(expected - actual) <= tolerance, "$message expected $expected ± $tolerance, was $actual")

    @Test
    fun atAStopItReadsAsTheStopList() {
        val legs = listOf(leg(listOf(at(0.0), at(1000.0)), climbM = 80.0), leg(listOf(at(1000.0), at(1000.0, 1500.0)), climbM = 40.0))
        val route = Route(listOf(stop(at(0.0)), stop(at(1000.0)), stop(at(1000.0, 1500.0))), legs)

        val start = route.progress(0.0)
        assertEquals(1, start.nextStop)
        val stopList = readingsFrom(legs, 0).drop(1).map { it!! }
        assertEquals(stopList.size, start.ahead.size)
        stopList.zip(start.ahead).forEach { (expected, reading) ->
            near(expected.distanceM, reading.distanceM, 0.01)
            near(expected.ascentM, reading.ascentM, 0.01)
            assertFalse(reading.incomplete)
        }
        near(planTotals(legs).distanceM, start.toFinish.distanceM, 0.01)
        near(planTotals(legs).ascentM, start.toFinish.ascentM, 0.01)
    }

    @Test
    fun aRoutedLegIsAsLongAndClimbsAsMuchAsTheRouterSaid() {
        val routed = leg(listOf(at(0.0), at(1000.0)), climbM = 100.0, reportedM = 1100.0)
        val route = Route(listOf(stop(at(0.0)), stop(at(1000.0))), listOf(routed))

        near(1100.0, route.totalM, 0.01)
        val halfway = route.progress(route.locate(at(500.0, 12.0))!!.alongM)
        near(550.0, halfway.toFinish.distanceM, 3.0)
        near(50.0, halfway.toFinish.ascentM, 3.0)
    }

    @Test
    fun offTheRouteTheReadoutsAreFromItsNearestPoint() {
        val route = Route(listOf(stop(at(0.0)), stop(at(2000.0))), listOf(leg(listOf(at(0.0), at(2000.0)))))

        val beside = route.locate(at(700.0, 800.0))!!
        near(700.0, beside.alongM)
        near(800.0, beside.offM, 5.0)
        near(1300.0, route.progress(beside.alongM).toFinish.distanceM)
    }

    @Test
    fun onAnOutAndBackTheWayYouAreGoingWins() {
        // Out 1000 m north and back down the other side of the same road, 6 m over.
        val out = leg(listOf(at(0.0), at(1000.0)))
        val back = leg(listOf(at(1000.0), at(1000.0, 6.0), at(0.0, 6.0)))
        val route = Route(listOf(stop(at(0.0)), stop(at(1000.0)), stop(at(0.0, 6.0))), listOf(out, back))
        val follower = Follower(route)

        // Up the one side, round the turnaround, down the other: within reach of both passes all the way.
        for (m in 0..990 step 10) near(m.toDouble(), follower.follow(at(m.toDouble(), 1.0))!!.alongM, 3.0, "out at $m:")
        near(1003.0, follower.follow(at(1000.0, 3.0))!!.alongM, 3.0, "turning:")
        for (m in 990 downTo 0 step 10) near(2006.0 - m, follower.follow(at(m.toDouble(), 5.0))!!.alongM, 3.0, "back at $m:")
    }

    @Test
    fun aFigureOfEightsCrossingKeepsTheLoopYouAreOn() {
        // Two loops of 800 m sides sharing one corner, which is crossed twice.
        val eight = listOf(
            at(0.0), at(400.0), at(400.0, 400.0), at(0.0, 400.0), at(-400.0, 400.0),
            at(-400.0, 800.0), at(0.0, 800.0), at(0.0, 400.0), at(0.0),
        )
        val route = Route(listOf(stop(eight.first()), stop(eight.last())), listOf(leg(eight)))
        val follower = Follower(route)

        // Along the first stretch into the crossing, then out of it the way the plan goes.
        val first = route.locate(at(400.0, 200.0))!!.alongM
        follower.follow(at(400.0, 200.0))
        val crossing = follower.follow(at(0.0, 399.0))!!.alongM
        assertTrue(crossing < route.totalM / 2, "the first pass of the crossing, at $crossing of ${route.totalM}; came from $first")
        val onward = follower.follow(at(-200.0, 400.0))!!.alongM
        assertTrue(onward > crossing, "on from the crossing: $onward after $crossing")
    }

    @Test
    fun aShortcutRejoinsFurtherOnAndRidingBackMovesTheReadoutsBack() {
        val square = listOf(at(0.0), at(1000.0), at(1000.0, 1000.0), at(0.0, 1000.0))
        val route = Route(listOf(stop(square.first()), stop(square.last())), listOf(leg(square)))
        val follower = Follower(route)

        near(500.0, follower.follow(at(500.0))!!.alongM)
        // Straight across, onto the far side.
        near(2500.0, follower.follow(at(500.0, 1000.0))!!.alongM)
        near(2200.0, follower.follow(at(800.0, 1000.0))!!.alongM)
    }

    @Test
    fun theNextStopIsTheFirstBeyondWhereYouAre() {
        val legs = listOf(leg(listOf(at(0.0), at(1000.0))), leg(listOf(at(1000.0), at(2000.0))))
        val route = Route(listOf(stop(at(0.0)), stop(at(1000.0)), stop(at(2000.0))), legs)

        assertEquals(1, route.progress(999.0).nextStop)
        near(1.0, route.progress(999.0).ahead.first().distanceM, 0.01)
        assertEquals(2, route.progress(route.stops[1]).nextStop)
        assertEquals(1, route.progress(route.stops[1]).leg)
        assertEquals(1, route.progress(route.stops[1]).ahead.size)
        assertNull(route.progress(route.totalM).nextStop)
        assertTrue(route.progress(route.totalM).ahead.isEmpty())
    }

    @Test
    fun aLegThatIsNotRoutedCountsForNothingAndSaysSo() {
        val first = leg(listOf(at(0.0), at(1000.0)), climbM = 50.0)
        val third = leg(listOf(at(2000.0), at(3000.0)), climbM = 30.0)
        val waypoints = listOf(stop(at(0.0)), stop(at(1000.0)), stop(at(2000.0)), stop(at(3000.0)))
        val routing = Route(waypoints, listOf<Leg?>(first, null, third))
        val failed = Route(waypoints, listOf(first, FailedLeg(waypoints[1], waypoints[2], "no route"), third))

        for (route in listOf(routing, failed)) {
            near(3000.0, route.totalM, 1.0)
            val progress = route.progress(500.0)
            assertFalse(progress.ahead[0].incomplete)
            assertTrue(progress.ahead[1].incomplete)
            assertTrue(progress.toFinish.incomplete)
            near(1500.0, progress.toFinish.distanceM, 1.0)
            near(55.0, progress.toFinish.ascentM, 1.0)
            // Beyond it, the totals are whole again.
            assertFalse(route.progress(2500.0).toFinish.incomplete)

            // The profile keeps the gap, as long as its straight line.
            val terrain = assertNotNull(route.terrain())
            near(3000.0, terrain.totalM, 1.0)
            assertTrue(terrain.altitudeM.any { it == null })
            assertTrue(terrain.distances.indices.none { terrain.altitudeM[it] != null && terrain.distances[it] in 1001.0..1999.0 })
        }
    }

    @Test
    fun aLegsTerrainIsMeasuredFromItsStart() {
        val legs = listOf(leg(listOf(at(0.0), at(1000.0))), leg(listOf(at(1000.0), at(1600.0)), climbM = 60.0))
        val route = Route(listOf(stop(at(0.0)), stop(at(1000.0)), stop(at(1600.0))), legs)

        val terrain = assertNotNull(route.legTerrain(1))
        near(0.0, terrain.distances.first(), 0.01)
        near(600.0, terrain.totalM, 1.0)
        near(700.0, terrain.altitudeM.first()!!, 0.01)
        near(760.0, terrain.altitudeM.last()!!, 0.01)
    }

    @Test
    fun aDetourAheadKeepsWhereYouAre() {
        val waypoints = listOf(stop(at(0.0)), stop(at(2000.0)))
        val follower = Follower(Route(waypoints, listOf(leg(listOf(at(0.0), at(2000.0))))))
        near(600.0, follower.follow(at(600.0, 5.0))!!.alongM)

        // A detour 1000 m east at the 1500 m mark lengthens the leg ahead of you.
        val detour = leg(listOf(at(0.0), at(1500.0), at(1500.0, 1000.0), at(2000.0)))
        follower.reroute(Route(waypoints, listOf(detour)))

        val progress = assertNotNull(follower.progress())
        near(600.0, progress.alongM)
        near(detour.distanceM - 600.0, progress.toFinish.distanceM, 3.0)
    }

    @Test
    fun aRouteWithNoLegsHasNothingToMatch() {
        assertNull(Route(listOf(stop(at(0.0))), emptyList()).locate(at(0.0)))
        assertNull(Follower(Route(emptyList(), emptyList())).follow(at(0.0)))
    }
}
