package net.stho.tracks.store

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.addWaypoint
import net.stho.tracks.plan.moveWaypoint
import net.stho.tracks.plan.updateWaypoint
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.routing.NoRoutingData
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class PlanEditorTest {
    private val plan = Plan(
        name = "Three legs",
        profile = Profile.Trekking,
        waypoints = listOf(
            Waypoint(47.49171, 11.09505, WaypointKind.Poi, "A"),
            Waypoint(47.48, 11.11, WaypointKind.Poi, "B"),
            Waypoint(47.47, 11.12, WaypointKind.Poi, "C"),
            Waypoint(47.46, 11.14, WaypointKind.Poi, "D"),
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

    /** Every leg the plan opened with, routed. */
    private val opened = StoredPlan("opened", 1_000, plan, listOf(0, 1, 2).map { routed(plan.waypoints.subList(it, it + 2)) })

    private class Router(val answer: (List<Waypoint>) -> Leg) : LegRouting {
        val asked = mutableListOf<List<Waypoint>>()
        val gates = HashMap<String, CompletableDeferred<Unit>>()
        val cancelled = mutableListOf<String>()

        override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
            asked.add(stretch)
            val name = stretch.last().name ?: "${stretch.last().lat}"
            try {
                gates[name]?.await()
            } catch (e: kotlinx.coroutines.CancellationException) {
                cancelled.add(name)
                throw e
            }
            if (stretch.last().lat == 40.0) throw NoRoutingData("E20_N40.rd5")
            return answer(stretch)
        }
    }

    @Test
    fun movingAStopRoutesOnlyTheTwoLegsItTouches() = runTest {
        val router = Router(::routed)
        val editor = PlanEditor(opened, router, this)
        runCurrent()
        assertEquals(emptyList(), router.asked, "a plan whose legs are all routed routes nothing")

        editor.update(moveWaypoint(editor.state.value.plan, 2, Coordinate(47.4712345, 11.1212345)))
        // Said at once, before the engine has had a moment: the beeline is drawn the instant the edit lands.
        assertEquals(setOf(1, 2), editor.state.value.routing)
        assertSame(opened.legs[0]!!.coordinates, editor.state.value.legs[0]!!.coordinates, "the untouched leg keeps the geometry it opened with")

        advanceUntilIdle()
        assertEquals(listOf("C", "D"), router.asked.map { it.last().name })
        assertTrue(editor.state.value.legs.all { it is RoutedLeg })
        assertEquals(47.47123, editor.state.value.plan.waypoints[2].lat, "an edit lands at the link's precision")
    }

    @Test
    fun aNewerEditToALegCancelsTheRouteInFlight() = runTest {
        val router = Router(::routed).apply { gates["C"] = CompletableDeferred() }
        val editor = PlanEditor(opened, router, this)

        editor.update(moveWaypoint(editor.state.value.plan, 2, Coordinate(47.471, 11.121)))
        runCurrent()
        editor.update(moveWaypoint(editor.state.value.plan, 2, Coordinate(47.472, 11.122)))
        router.gates.remove("C")?.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf("C"), router.cancelled, "the first route into C is abandoned")
        assertEquals(47.472, (editor.state.value.legs[1] as RoutedLeg).to.lat)
        assertEquals(emptySet(), editor.state.value.routing)
    }

    @Test
    fun renamingAStopKeepsItsLegs() = runTest {
        val router = Router(::routed)
        val editor = PlanEditor(opened, router, this)

        editor.update(updateWaypoint(editor.state.value.plan, 1) { it.copy(name = "Bee") })
        advanceUntilIdle()

        assertEquals(emptyList(), router.asked)
        assertEquals("Bee", (editor.state.value.legs[0] as RoutedLeg).to.name)
        assertTrue(editor.state.value.changed)
    }

    @Test
    fun aLegWithNoDataStaysUnroutedAndSaysSo() = runTest {
        val router = Router(::routed)
        val editor = PlanEditor(opened, router, this)

        editor.update(addWaypoint(editor.state.value.plan, Waypoint(40.0, 20.0, WaypointKind.Poi, null), 4))
        advanceUntilIdle()

        assertNull(editor.state.value.legs[3])
        assertEquals(setOf(3), editor.state.value.noData)
    }

    @Test
    fun undoRoutesTheLegsItChangesAndRedoGoesForwardAgain() = runTest {
        val router = Router(::routed)
        val editor = PlanEditor(opened, router, this)
        assertFalse(editor.state.value.canUndo)

        editor.update(moveWaypoint(plan, 2, Coordinate(47.471, 11.121)))
        advanceUntilIdle()
        router.asked.clear()

        editor.undo()
        assertEquals(plan, editor.state.value.plan)
        assertEquals(setOf(1, 2), editor.state.value.routing, "no legs are kept for an undo: the two it changes route again")
        assertSame(opened.legs[0]!!.coordinates, editor.state.value.legs[0]!!.coordinates, "the leg it left alone is kept")
        advanceUntilIdle()
        assertEquals(listOf("C", "D"), router.asked.map { it.last().name })
        assertFalse(editor.state.value.changed, "back at the plan it opened, legs routed again on the phone are nothing to save")
        assertTrue(editor.state.value.canRedo)

        editor.redo()
        assertEquals(47.471, editor.state.value.plan.waypoints[2].lat)
        assertTrue(editor.state.value.changed)
        assertFalse(editor.state.value.canRedo)
    }

    @Test
    fun anEditAfterAnUndoDropsWhatCouldBeRedone() = runTest {
        val editor = PlanEditor(opened, Router(::routed), this)

        editor.update(plan.copy(profile = Profile.Gravel))
        editor.undo()
        editor.update(plan.copy(profile = Profile.Road))

        assertFalse(editor.state.value.canRedo)
        editor.undo()
        assertEquals(Profile.Trekking, editor.state.value.plan.profile)
        assertFalse(editor.state.value.canUndo)
    }

    @Test
    fun undoCancelsTheRouteOfALegItRemoves() = runTest {
        val router = Router(::routed).apply { gates["C"] = CompletableDeferred() }
        val editor = PlanEditor(opened, router, this)

        editor.update(moveWaypoint(plan, 2, Coordinate(47.471, 11.121)))
        runCurrent()
        editor.undo()
        router.gates.remove("C")?.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf("C"), router.cancelled)
        assertEquals(47.47, (editor.state.value.legs[1] as RoutedLeg).to.lat)
    }

    @Test
    fun typingIntoOneNameIsOneStep() = runTest {
        val editor = PlanEditor(opened, Router(::routed), this)

        for (typed in listOf("B", "Be", "Bee")) editor.update(updateWaypoint(editor.state.value.plan, 1) { it.copy(name = typed) })
        for (typed in listOf("T", "Tr")) editor.update(editor.state.value.plan.copy(name = typed))
        editor.update(updateWaypoint(editor.state.value.plan, 1) { it.copy(name = "Beet") })

        editor.undo()
        assertEquals("Bee", editor.state.value.plan.waypoints[1].name, "typing into another name starts a step of its own")
        editor.undo()
        assertEquals("Three legs", editor.state.value.plan.name)
        editor.undo()
        assertEquals(plan, editor.state.value.plan)
        assertFalse(editor.state.value.canUndo)
    }

    @Test
    fun aNameFoundLateBelongsToAddingTheStop() = runTest {
        val editor = PlanEditor(opened, Router(::routed), this)
        editor.update(addWaypoint(plan, Waypoint(47.45, 11.15, WaypointKind.Poi, null), 4))
        val placed = editor.state.value.plan.waypoints[4]
        editor.update(editor.state.value.plan.copy(profile = Profile.Gravel))

        editor.nameFound(placed, "Hut")
        assertEquals("Hut", editor.state.value.plan.waypoints[4].name)

        editor.undo()
        assertEquals("Hut", editor.state.value.plan.waypoints[4].name, "undoing what came after keeps the name")
        editor.undo()
        assertEquals(plan, editor.state.value.plan, "the name was no step of its own")
        editor.redo()
        assertEquals("Hut", editor.state.value.plan.waypoints[4].name)
    }

    @Test
    fun historyKeepsTheLastHundredSteps() = runTest {
        val editor = PlanEditor(opened, Router(::routed), this)

        repeat(101) { step -> editor.update(editor.state.value.plan.copy(profile = if (step % 2 == 0) Profile.Gravel else Profile.Trekking)) }
        repeat(100) { editor.undo() }

        assertFalse(editor.state.value.canUndo)
        assertEquals(Profile.Gravel, editor.state.value.plan.profile, "the first step fell off")
    }

    @Test
    fun saveOverwritesAndCopyKeepsTheOriginal() = runTest {
        val fileSystem = FakeFileSystem()
        var ids = 0
        val library = PlanLibrary(
            store = PlanStore("/plans".toPath(), fileSystem),
            router = Router(::routed),
            scope = this,
            io = StandardTestDispatcher(testScheduler),
            now = { 5_000L + ids },
            newId = { "new${ids++}" },
        )
        library.save(opened.id, opened.plan, opened.legs)

        val editor = PlanEditor(library.find("opened")!!, Router(::routed), this)
        editor.update(editor.state.value.plan.copy(name = "Renamed"))
        val copy = editor.saveAsNew(library)
        advanceUntilIdle()

        assertEquals(setOf("Three legs", "Renamed"), library.plans.value.map { it.plan.name }.toSet())
        assertIs<RoutedLeg>(copy.legs[0])

        val again = PlanEditor(library.find("opened")!!, Router(::routed), this)
        again.update(again.state.value.plan.copy(profile = Profile.Gravel))
        again.save(library)
        advanceUntilIdle()

        val saved = library.find("opened")!!
        assertEquals(Profile.Gravel, saved.plan.profile)
        assertTrue(saved.legs.all { it is RoutedLeg }, "a changed profile re-routes every leg, in the library once saved")
    }

    @Test
    fun aNewPlanIsSaveableOnceItHasAStartAndAnEndAndIsKeptOnlyThen() = runTest {
        val fileSystem = FakeFileSystem()
        val library = PlanLibrary(
            store = PlanStore("/plans".toPath(), fileSystem),
            router = Router(::routed),
            scope = this,
            io = StandardTestDispatcher(testScheduler),
            now = { 5_000L },
        )
        val editor = PlanEditor.blank(Router(::routed), this, id = "fresh")
        assertTrue(editor.new)
        assertEquals(Plan(), editor.state.value.plan)

        editor.update(editor.state.value.plan.copy(name = "Somewhere"))
        assertTrue(editor.state.value.changed)
        assertFalse(editor.state.value.saveable, "a name alone is not a plan")

        editor.update(addWaypoint(editor.state.value.plan, plan.waypoints[0], 0))
        assertFalse(editor.state.value.saveable, "one point is not a plan")

        editor.update(addWaypoint(editor.state.value.plan, plan.waypoints[1], 1))
        advanceUntilIdle()
        assertTrue(editor.state.value.saveable)
        assertEquals(emptyList(), library.plans.value, "nothing is kept before Save")

        editor.save(library)
        advanceUntilIdle()

        val saved = library.find("fresh")!!
        assertEquals("Somewhere", saved.plan.name)
        assertIs<RoutedLeg>(saved.legs.single())
        assertEquals(listOf(saved), PlanStore("/plans".toPath(), fileSystem).list())
    }

    @Test
    fun anOpenedPlanIsSaveableOnceChanged() = runTest {
        val editor = PlanEditor(opened, Router(::routed), this)
        assertFalse(editor.new)
        assertFalse(editor.state.value.saveable)

        editor.update(editor.state.value.plan.copy(name = "Renamed"))
        assertTrue(editor.state.value.saveable)
    }
}
