package net.stho.tracks.ui.sensors

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.pressureAt

class ReplayTest {
    private val t0 = 1_783_062_000_000L

    private fun point(lat: Double, lon: Double, second: Int, ele: Double? = 500.0) =
        TrackPoint(Coordinate(lat, lon), ele, t0 + second * 1000L)

    private fun near(expected: Double, actual: Double?, tolerance: Double) =
        assertTrue(actual != null && abs(expected - actual) <= tolerance, "expected $expected ± $tolerance, was $actual")

    // Due north 100 m in 10 s, stand for 20 s, then due east 100 m in 10 s.
    private val north = 100.0 / (6_371_000.0 * kotlin.math.PI / 180.0)
    private val ride = RideReplay(
        listOf(
            point(47.0, 11.0, 0, ele = 500.0),
            point(47.0 + north, 11.0, 10, ele = 510.0),
            point(47.0 + north, 11.0, 30, ele = 510.0),
            point(47.0 + north, 11.0 + north / kotlin.math.cos(47.0 * kotlin.math.PI / 180), 40, ele = 510.0),
        ),
    )

    @Test
    fun oneFixASecondFromFirstToLast() {
        assertEquals(41, ride.fixes.size)
        assertEquals((0..40).map { t0 + it * 1000L }, ride.fixes.map { it.epochMillis })
    }

    @Test
    fun positionAndAltitudeAreInterpolatedInTime() {
        val halfway = ride.fixes[5]
        near(47.0 + north / 2, halfway.at.lat, 1e-9)
        near(505.0, halfway.altitudeM, 1e-9)
        near(10.0, halfway.speedMps, 0.05)
        near(0.0, halfway.courseDeg, 0.01)
    }

    @Test
    fun aStopHasNoCourseButKeepsItsHeading() {
        val standing = ride.fixes[20]
        assertEquals(0.0, standing.speedMps)
        assertNull(standing.courseDeg)
        near(0.0, ride.headings[20], 0.01)

        near(90.0, ride.fixes[35].courseDeg, 0.1)
        near(90.0, ride.headings[35], 0.1)
    }

    @Test
    fun untimedPointsAreRiddenAtTheAssumedSpeed() {
        val untimed = RideReplay(
            listOf(TrackPoint(Coordinate(47.0, 11.0), null, null), TrackPoint(Coordinate(47.0 + north, 11.0), null, null)),
            assumedSpeedMps = 5.0,
        )
        assertEquals(21, untimed.fixes.size)
        near(5.0, untimed.fixes[3].speedMps, 0.05)
        assertNull(untimed.fixes[3].altitudeM)
    }

    @Test
    fun theBarometerIsTheStandardAtmosphere() {
        near(1013.25, pressureAt(0.0), 1e-9)
        near(898.75, pressureAt(1000.0), 0.05)
        near(795.0, pressureAt(2000.0), 0.1)
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test
    fun sensorsEmitOnceASecondFromWhereTheyAreAsked() = runTest {
        val sensors = ReplaySensors(ride, fromSecond = 20)
        val fixes = sensors.fixes.take(3).toList()
        assertEquals(listOf(0.0, 0.0, 0.0), fixes.map { it.speedMps })
        assertEquals(2_000, currentTime)

        val pressures = ReplaySensors(ride, fromSecond = 10, speedup = 4.0).pressures.take(5).toList()
        near(pressureAt(510.0), pressures.last().hPa, 0.01)
        assertEquals(1_000, currentTime - 2_000)
    }
}
