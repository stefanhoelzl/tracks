package net.stho.tracks.ui.recording

import kotlin.math.PI
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.RideFrame
import net.stho.tracks.recording.Rides
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.pressureAt
import net.stho.tracks.ui.sensors.Sensors
import okio.FileSystem

@OptIn(ExperimentalCoroutinesApi::class)
class RecorderTest {
    private val t0 = 1_783_062_000_000L
    private val metre = 1.0 / (6_371_000.0 * PI / 180.0)
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-recorder-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = FileSystem.SYSTEM.deleteRecursively(dir)

    private class FakeSensors : Sensors {
        override val fixes = MutableSharedFlow<Fix>()
        override val headings = emptyFlow<net.stho.tracks.sensors.Heading>()
        override val pressures = MutableSharedFlow<Pressure>()
    }

    private fun TestScope.recorder(sensors: Sensors, scope: CoroutineScope = backgroundScope) =
        Recorder(Rides(dir), sensors, scope, dateTitle = { "3 Jul 2026" }, clock = { t0 + testScheduler.currentTime })

    /** A second of riding north at 5 m/s, climbing half a metre: a fix and a pressure. */
    private suspend fun TestScope.ride(sensors: FakeSensors, second: Int, accuracy: Double = 4.0) {
        val now = t0 + testScheduler.currentTime
        sensors.pressures.emit(Pressure(pressureAt(700 + second * 0.5), now))
        sensors.fixes.emit(Fix(Coordinate(47.0 + second * 5 * metre, 11.0), 710.0, 0.0, 5.0, accuracy, now))
        advanceTimeBy(1000)
        runCurrent()
    }

    @Test
    fun aRideIsRecordedStoppedAndSaved() = runTest {
        val sensors = FakeSensors()
        val recorder = recorder(sensors)
        assertEquals(RecorderState.Idle, recorder.state.value)

        recorder.start()
        runCurrent()
        (0..60).forEach { ride(sensors, it) }
        ride(sensors, 61, accuracy = 45.0) // not kept

        val recording = assertIs<RecorderState.Recording>(recorder.state.value)
        assertEquals(300.0, recording.distanceM, 1.0)
        assertEquals(30.0, recording.climbedM!!, 1.0)
        assertEquals(61, recorder.track.value.size)

        recorder.stop()
        val stopped = assertIs<RecorderState.Stopped>(recorder.state.value)
        assertEquals("3 Jul 2026", stopped.title)
        assertEquals("bike", stopped.sport)

        assertEquals(61, recorder.track.value.size)
        recorder.save("  ", "hike")
        assertEquals(RecorderState.Idle, recorder.state.value)
        assertEquals(emptyList(), recorder.track.value)

        val frame = RideFrame.of(Rides(dir).get(stopped.id))
        assertEquals("3 Jul 2026", frame.title)
        assertEquals(listOf("sport:hike"), frame.tags)
        assertEquals(61, frame.times!!.size)
        assertEquals(30.0, frame.elevationGainM)
    }

    @Test
    fun whatArrivesDuringAPauseIsNotKept() = runTest {
        val sensors = FakeSensors()
        val recorder = recorder(sensors)
        recorder.start(plan = "Zugspitze loop", profile = "hiking")
        runCurrent()
        (0..10).forEach { ride(sensors, it) }
        recorder.pause()
        (11..30).forEach { ride(sensors, it) }
        assertTrue(assertIs<RecorderState.Recording>(recorder.state.value).paused)
        recorder.resume()
        (31..40).forEach { ride(sensors, it) }
        recorder.stop()

        val stopped = assertIs<RecorderState.Stopped>(recorder.state.value)
        assertEquals("Zugspitze loop", stopped.title)
        assertEquals("hike", stopped.sport)
        assertEquals(21, Rides(dir).get(stopped.id).fixes.size)
    }

    @Test
    fun aRideTheAppDiedDuringIsOfferedAndContinued() = runTest {
        val sensors = FakeSensors()
        val dying = CoroutineScope(backgroundScope.coroutineContext + kotlinx.coroutines.Job())
        val first = recorder(sensors, dying)
        first.start()
        runCurrent()
        (0..12).forEach { ride(sensors, it) }
        // Killed: no stop, no close, and whatever was not flushed yet is gone with the process.
        dying.cancel()

        val second = recorder(sensors)
        val interrupted = assertIs<RecorderState.Interrupted>(second.state.value)
        val kept = Rides(dir).get(interrupted.id).fixes.size
        assertTrue(kept in 6..11, "kept $kept of 13 fixes")

        advanceTimeBy(60_000)
        second.continueRide()
        runCurrent()
        assertEquals(kept, second.track.value.size)
        (20..30).forEach { ride(sensors, it) }
        second.stop()
        assertIs<RecorderState.Stopped>(second.state.value)
        assertEquals(kept + 11, Rides(dir).get(interrupted.id).fixes.size)
    }

    @Test
    fun aRideThatFollowsAPlanStillFollowsItWhenContinued() = runTest {
        val sensors = FakeSensors()
        val dying = CoroutineScope(backgroundScope.coroutineContext + kotlinx.coroutines.Job())
        val first = recorder(sensors, dying)
        first.start(plan = "Partnachklamm", profile = "hiking", planId = "plan-1")
        runCurrent()
        assertEquals("plan-1", assertIs<RecorderState.Recording>(first.state.value).planId)
        (0..12).forEach { ride(sensors, it) }
        dying.cancel()

        val second = recorder(sensors)
        second.continueRide()
        runCurrent()
        assertEquals("plan-1", assertIs<RecorderState.Recording>(second.state.value).planId)

        // A ride with no plan follows none, continued or not.
        second.stop()
        second.discard()
        second.start()
        runCurrent()
        assertNull(assertIs<RecorderState.Recording>(second.state.value).planId)
    }

    @Test
    fun theRideSoFarHasAProfileUntilItIsSaved() = runTest {
        val sensors = FakeSensors()
        val recorder = recorder(sensors)
        recorder.start()
        runCurrent()
        assertNull(recorder.elevation.value)
        (0..60).forEach { ride(sensors, it) }

        val terrain = recorder.elevation.value!!
        assertEquals(300.0, terrain.totalM, 30.0)
        assertTrue(terrain.altitudeM.last()!! - terrain.altitudeM.first()!! in 25.0..31.0, "climbed ${terrain.altitudeM}")

        recorder.stop()
        recorder.save("Evening", "bike")
        assertNull(recorder.elevation.value)
    }

    @Test
    fun stoppedBeforeTheFirstFixThereIsNothingToSave() = runTest {
        val recorder = recorder(FakeSensors())
        recorder.start()
        runCurrent()
        recorder.stop()
        assertEquals(RecorderState.Idle, recorder.state.value)
        assertEquals(emptyList(), Rides(dir).all())
    }

    @Test
    fun aStoppedRideIsStillAskedAboutAfterARestartAndCanBeDiscarded() = runTest {
        val sensors = FakeSensors()
        val first = recorder(sensors)
        first.start()
        runCurrent()
        ride(sensors, 0)
        first.stop()

        val second = recorder(sensors)
        val stopped = assertIs<RecorderState.Stopped>(second.state.value)
        second.discard()
        assertEquals(RecorderState.Idle, second.state.value)
        assertNull(Rides(dir).all().firstOrNull { it.id == stopped.id })
    }

    @Test
    fun aSavedRideIsNotAskedAboutAgain() = runTest {
        val sensors = FakeSensors()
        val first = recorder(sensors)
        first.start()
        runCurrent()
        ride(sensors, 0)
        first.stop()
        first.save("Morning", "bike")

        assertEquals(RecorderState.Idle, recorder(sensors).state.value)
        assertIs<Entry.Saved>(Rides(dir).all().single().entries.last())
    }
}
