package net.stho.tracks.ui.riding

import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.recording.Rides
import net.stho.tracks.riding.Detour
import net.stho.tracks.riding.RideEdits
import net.stho.tracks.riding.detour
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.distanceM
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.sensors.Gpx
import net.stho.tracks.ui.sensors.RideReplay
import net.stho.tracks.ui.sensors.Sensors
import okio.FileSystem
import okio.Path.Companion.toPath

/**
 * The bundled Garmisch ride, replayed through the recorder and the navigator as the harness runs them, following the
 * plan the riding scenes follow — with a detour made on the way.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReplayedDetourTest {
    private val xml = FileSystem.SYSTEM.read("src/commonMain/composeResources/files/rides/garmisch.gpx".toPath()) { readUtf8() }
    private val fixture = "../desktopApp/screenshots/fixture/riding".toPath()
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-detour-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = FileSystem.SYSTEM.deleteRecursively(dir)

    private class FakeSensors : Sensors {
        override val fixes = MutableSharedFlow<Fix>(replay = 1)
        override val headings = emptyFlow<Heading>()
        override val pressures = emptyFlow<Pressure>()
    }

    /** brouter.de, or the engine, as far as a test needs one: a straight line through the stretch. */
    private class Router : LegRouting {
        var asked = 0

        override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
            asked++
            val points = stretch.map { Coordinate(it.lat, it.lon) }
            return RoutedLeg(
                stretch.first(), stretch.last(), points, points.map { 750.0 },
                points.zipWithNext().sumOf { (a, b) -> distanceM(a, b) }, 0.0, 0.0, 0.0,
            )
        }
    }

    @Test
    fun aDetourMidRideIsFollowedAndTheRecordingNeverStops() = runTest {
        val stored = PlanStore(fixture, FileSystem.SYSTEM).list().single()
        val router = Router()
        val library = PlanLibrary(PlanStore(dir / "plans", FileSystem.SYSTEM), router, backgroundScope, StandardTestDispatcher(testScheduler), now = { 1L })
        library.save(stored.id, stored.plan, stored.legs)

        val sensors = FakeSensors()
        val recorder = Recorder(Rides(dir / "rides"), sensors, backgroundScope, dateTitle = { "today" }, clock = { testScheduler.currentTime })
        val navigator = Navigator(sensors, library.plans, backgroundScope)
        recorder.start(stored.plan.name, stored.plan.profile.wire, stored.id)
        navigator.follow(stored.id)
        runCurrent()

        val fixes = RideReplay(Gpx.trackPoints(xml)).fixes
        suspend fun TestScope.ride(seconds: IntRange) = seconds.forEach {
            sensors.fixes.emit(fixes[it])
            advanceTimeBy(1000)
            runCurrent()
        }

        ride(0..599)
        val before = assertNotNull(navigator.state.value?.progress)
        assertEquals(0, before.leg)
        assertEquals(1, before.nextStop)

        // A long press 300 m north of the road ahead: through there, on the way to the same stop.
        val plan = library.find(stored.id)!!
        val at = fixes[800].at.let { Coordinate(it.lat + 0.0027, it.lon) }
        val edits = RideEdits(library, stored.id)
        edits.update(detour(plan.plan, plan.legs, before.leg, at, Detour.Through, name = null))
        ride(600..609)

        val detoured = assertNotNull(navigator.state.value)
        assertEquals(4, detoured.plan.plan.waypoints.size)
        assertTrue(detoured.plan.legs.all { it is RoutedLeg }, "the detoured leg routed")
        assertEquals(1, router.asked, "only the leg the detour is in")
        assertTrue(detoured.route.locate(at)!!.offM < 20, "the route goes through the detour")
        assertEquals(1, assertNotNull(detoured.progress).nextStop)
        assertFalse(assertIs<RecorderState.Recording>(recorder.state.value).paused)

        // Taking it back is the plan as it was, at once.
        edits.undo()
        ride(610..619)
        assertEquals(stored.plan, navigator.state.value!!.plan.plan)
        assertEquals(1, router.asked)
        edits.redo()
        ride(620 until fixes.size)

        // Ridden to the end, recorded all the way, and the ride still follows the plan.
        val end = assertNotNull(navigator.state.value?.progress)
        assertTrue((end.ahead.firstOrNull()?.distanceM ?: 0.0) < 50, "at the finish: ${end.ahead}")
        assertEquals(fixes.size, recorder.track.value.size)
        val id = assertIs<RecorderState.Recording>(recorder.state.value).id
        recorder.stop()
        assertEquals(stored.id, Rides(dir / "rides").get(id).following)
    }
}
