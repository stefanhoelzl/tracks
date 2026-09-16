package net.stho.tracks.riding

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem

class DetoursTest {
    private fun stop(lat: Double, lon: Double, name: String?) = Waypoint(lat, lon, WaypointKind.Poi, name)

    /** Garmisch to Kaltenbrunn by way of a stop, east along one parallel. */
    private val plan = Plan(
        name = "Out of Garmisch",
        profile = Profile.Trekking,
        waypoints = listOf(stop(47.49, 11.09, "Garmisch"), stop(47.49, 11.12, null), stop(47.49, 11.17, "Kaltenbrunn")),
    )

    /** Every leg the straight line through its waypoints; counts what it was asked. */
    private class Router : LegRouting {
        var asked = 0

        override suspend fun route(stretch: List<Waypoint>, profile: Profile): RoutedLeg {
            asked++
            return RoutedLeg(
                stretch.first(), stretch.last(), stretch.map { Coordinate(it.lat, it.lon) }, stretch.map { 700.0 },
                1000.0 * stretch.size, 0.0, 0.0, 0.0,
            )
        }
    }

    private fun TestScope.library(router: Router) = PlanLibrary(
        store = PlanStore("/plans".toPath(), FakeFileSystem()),
        router = router,
        scope = this,
        io = StandardTestDispatcher(testScheduler),
        now = { 1_000L },
        newId = { "plan" },
    )

    @Test
    fun throughAndStopGoIntoTheLegYouAreOnAndEndAfterTheFinish() {
        val here = Coordinate(47.495, 11.14)
        val legs = listOf(null, null)

        val through = detour(plan, legs, leg = 1, here, Detour.Through, name = "ignored")
        assertEquals(listOf("Garmisch", null, null, "Kaltenbrunn"), through.waypoints.map { it.name })
        assertEquals(WaypointKind.Routing, through.waypoints[2].kind)

        val stop = detour(plan, legs, leg = 1, here, Detour.Stop, name = "Hut")
        assertEquals(WaypointKind.Poi, stop.waypoints[2].kind)
        assertEquals("Hut", stop.waypoints[2].name)

        val end = detour(plan, legs, leg = 1, here, Detour.End, name = null)
        assertEquals(plan.waypoints + stop(47.495, 11.14, null), end.waypoints)

        assertEquals(plan, detour(plan, legs, leg = null, here, Detour.Through, name = null))
    }

    @Test
    fun anEditIsSavedAtOnceAndOnlyItsLegRoutesAgain() = runTest {
        val router = Router()
        val library = library(router)
        val stored = library.receive(plan)
        advanceUntilIdle()
        assertEquals(2, router.asked)

        val edits = RideEdits(library, stored.id)
        val first = library.find(stored.id)!!
        edits.update(detour(first.plan, first.legs, leg = 1, Coordinate(47.495, 11.14), Detour.Through, null))

        // Saved before anything routes: the new leg is missing, the untouched one kept.
        val saved = library.find(stored.id)!!
        assertEquals(4, saved.plan.waypoints.size)
        assertIs<RoutedLeg>(saved.legs[0])
        assertEquals(null, saved.legs[1])
        advanceUntilIdle()
        assertEquals(3, router.asked)
        assertTrue(library.find(stored.id)!!.legs.all { it is RoutedLeg })
        assertTrue(edits.state.value.canUndo)
    }

    @Test
    fun undoingADetourRoutesNothing() = runTest {
        val router = Router()
        val library = library(router)
        val stored = library.receive(plan)
        advanceUntilIdle()
        val edits = RideEdits(library, stored.id)
        val before = library.find(stored.id)!!

        edits.update(detour(before.plan, before.legs, leg = 0, Coordinate(47.5, 11.1), Detour.Stop, "Hut"))
        advanceUntilIdle()
        val asked = router.asked

        edits.undo()
        assertEquals(before.plan, library.find(stored.id)!!.plan)
        assertEquals(before.legs, library.find(stored.id)!!.legs)
        assertFalse(edits.state.value.canUndo)
        assertTrue(edits.state.value.canRedo)

        edits.redo()
        advanceUntilIdle()
        assertEquals(4, library.find(stored.id)!!.plan.waypoints.size)
        assertEquals(asked, router.asked)
    }
}
