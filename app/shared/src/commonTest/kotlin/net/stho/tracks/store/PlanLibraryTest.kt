package net.stho.tracks.store

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.routing.NoRoutingData
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlanLibraryTest {
    private val fileSystem = FakeFileSystem()
    private val directory = "/plans".toPath()

    /** Three stops, the last beyond the tiles: two legs, one of which has no data. */
    private val plan = Plan(
        name = "Garmisch",
        profile = Profile.Trekking,
        waypoints = listOf(
            Waypoint(47.4917123, 11.0950456, WaypointKind.Poi, "Garmisch"),
            Waypoint(47.45, 11.06, WaypointKind.Routing, null),
            Waypoint(47.4211, 10.9853, WaypointKind.Poi, "Zugspitze"),
            Waypoint(40.0, 20.0, WaypointKind.Poi, "Far away"),
        ),
    )

    private fun routed(stretch: List<Waypoint>) = RoutedLeg(
        from = stretch.first(),
        to = stretch.last(),
        coordinates = stretch.map { Coordinate(it.lat, it.lon) },
        altitudeM = stretch.map { 700.0 },
        distanceM = 1000.0,
        ascentM = 10.0,
        descentM = 10.0,
        durationS = 300.0,
    )

    /** Routes a leg once its gate is opened; a leg ending at 40° N has no tiles. */
    private class Router : LegRouting {
        val asked = mutableListOf<List<Waypoint>>()
        val gates = ArrayDeque<CompletableDeferred<Unit>>()
        var answer: (List<Waypoint>) -> Leg = { error("no answer") }

        override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
            asked.add(stretch)
            gates.removeFirstOrNull()?.await()
            if (stretch.last().lat == 40.0) throw NoRoutingData("E20_N40.rd5")
            return answer(stretch)
        }
    }

    private fun TestScope.library(router: Router, clock: MutableList<Long> = mutableListOf(1_000L)): PlanLibrary {
        var ids = 0
        return PlanLibrary(
            store = PlanStore(directory, fileSystem),
            router = router,
            // The test's own scope, not backgroundScope: advanceUntilIdle stops once only background work is left.
            scope = this,
            io = StandardTestDispatcher(testScheduler),
            now = { clock.removeFirstOrNull() ?: 9_999L },
            newId = { "plan${ids++}" },
        )
    }

    @Test
    fun keepsAPlanAtOnceAndRoutesItsLegsAfter() = runTest {
        val router = Router().apply { answer = ::routed }
        val gate = CompletableDeferred<Unit>().also { router.gates.add(it) }
        val library = library(router)

        val stored = library.receive(plan)
        runCurrent()

        // Kept as its link carries it: 1e-5, the precision the web routes it at.
        assertEquals(47.49171, stored.plan.waypoints[0].lat)
        assertEquals(listOf(null, null), library.plans.value.single().legs)
        assertEquals(PlanRouting(routing = 0), library.routing.value[stored.id])

        gate.complete(Unit)
        advanceUntilIdle()

        val legs = library.find(stored.id)!!.legs
        assertIs<RoutedLeg>(legs[0])
        assertNull(legs[1], "a leg with no tiles stays unrouted")
        assertEquals(PlanRouting(noData = setOf(1)), library.routing.value[stored.id])
        assertEquals(legs, PlanStore(directory, fileSystem).load(stored.id)!!.legs, "each leg is saved as it lands")
    }

    @Test
    fun routesWhatIsStillMissingWhenItStartsAgain() = runTest {
        val first = Router().apply { answer = { FailedLeg(it.first(), it.last(), "target island detected") } }
        library(first).receive(plan)
        advanceUntilIdle()

        val second = Router().apply { answer = ::routed }
        val library = library(second)
        library.start()
        advanceUntilIdle()

        assertEquals(listOf("Far away"), second.asked.map { it.last().name }, "a failed leg is an answer; only the missing one is asked again")
        assertEquals(1, library.plans.value.size)
    }

    @Test
    fun deletingAPlanStopsItsRouting() = runTest {
        val router = Router().apply { answer = ::routed }
        router.gates.add(CompletableDeferred())
        val library = library(router)

        val stored = library.receive(plan)
        runCurrent()
        library.delete(stored.id)
        advanceUntilIdle()

        assertEquals(emptyList(), library.plans.value)
        assertEquals(emptyMap(), library.routing.value)
        assertEquals(emptyList(), PlanStore(directory, fileSystem).list())
    }

    @Test
    fun aCopyIsANewPlanListedFirst() = runTest {
        val router = Router().apply { answer = ::routed }
        val library = library(router, clock = mutableListOf(1_000L, 2_000L))
        val original = library.receive(plan)
        advanceUntilIdle()

        val copy = library.copy(original.id)!!
        advanceUntilIdle()

        assertEquals(listOf(copy.id, original.id), library.plans.value.map { it.id })
        assertEquals(original.plan, copy.plan)
        assertTrue(copy.legs[0] is RoutedLeg, "the copy keeps the legs it was copied with")
    }
}
