package net.stho.tracks.recording

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix

class TallyTest {
    private val t0 = 1_783_062_000_000L

    /** Metres of latitude, as degrees. */
    private val metre = 1.0 / (6_371_000.0 * PI / 180.0)

    private fun fix(second: Int, northM: Double, speed: Double?, accuracy: Double = 5.0, eastM: Double = 0.0) =
        Fix(Coordinate(47.0 + northM * metre, 11.0 + eastM * metre / kotlin.math.cos(47.0 * PI / 180)), null, null, speed, accuracy, t0 + second * 1000L)

    private fun near(expected: Double, actual: Double, tolerance: Double) =
        assertTrue(abs(expected - actual) <= tolerance, "expected $expected ± $tolerance, was $actual")

    @Test
    fun aRideCountsAllItsDistanceAndTime() {
        val odometer = Odometer()
        (0..100).forEach { odometer.add(fix(it, it * 5.0, 5.0)) }
        near(500.0, odometer.distanceM, 0.5)
        assertEquals(100_000, odometer.movingMillis)
    }

    @Test
    fun aPhoneOnATableWandersNowhere() {
        val random = Random(7)
        val odometer = Odometer()
        (0..600).forEach { odometer.add(fix(it, random.nextDouble(-4.0, 4.0), 0.0, eastM = random.nextDouble(-4.0, 4.0))) }
        assertTrue(odometer.distanceM < 30, "wandered ${odometer.distanceM} m")
        assertEquals(0, odometer.movingMillis)
    }

    @Test
    fun aCrawlIsCountedInCoarserStepsToTheSameTotal() {
        val odometer = Odometer()
        (0..300).forEach { odometer.add(fix(it, it * 0.5, 0.5)) } // 1.8 km/h for five minutes
        near(150.0, odometer.distanceM, 5.0)
        assertEquals(300_000, odometer.movingMillis)
    }

    @Test
    fun aGapIsDistanceButNotMovingTime() {
        val odometer = Odometer()
        odometer.add(fix(0, 0.0, 6.0))
        odometer.add(fix(1, 6.0, 6.0))
        odometer.add(fix(301, 1806.0, 6.0)) // the app was dead for five minutes
        near(1806.0, odometer.distanceM, 0.5)
        assertEquals(1_000, odometer.movingMillis)
    }

    @Test
    fun aPauseIsNeither() {
        val tally = Tally()
        tally.add(Entry.Located(fix(0, 0.0, 6.0)))
        tally.add(Entry.Located(fix(1, 6.0, 6.0)))
        tally.add(Entry.Paused(t0 + 2000))
        tally.add(Entry.Resumed(t0 + 60_000))
        tally.add(Entry.Located(fix(600, 3000.0, 6.0)))
        tally.add(Entry.Located(fix(601, 3006.0, 6.0)))
        near(12.0, tally.odometer.distanceM, 0.5)
        assertEquals(2_000, tally.odometer.movingMillis)
    }

    @Test
    fun noiseIsNotAClimb() {
        val random = Random(3)
        val climb = Climb()
        repeat(3600) { climb.add(700.0 + random.nextDouble(-1.2, 1.2)) }
        assertEquals(0.0, climb.gainM)
    }

    @Test
    fun aClimbCountsBottomToTopAndDescentsCountNothing() {
        val random = Random(5)
        val climb = Climb()
        // Up 100 m, down 60, up 80, with a metre of noise on every reading.
        val profile = (0..100).map { it.toDouble() } + (99 downTo 40).map { it.toDouble() } + (41..120).map { it.toDouble() }
        profile.forEach { climb.add(500 + it + random.nextDouble(-0.5, 0.5)) }
        near(180.0, climb.gainM, 2.0)
    }

    @Test
    fun aClimbStillGoingCountsAsFarAsItHasGot() {
        val climb = Climb()
        (0..50).forEach { climb.add(it.toDouble()) }
        assertEquals(50.0, climb.gainM)
    }

    @Test
    fun rollingHillsBelowTheThresholdAreSmoothedAway() {
        val climb = Climb()
        (0..600).forEach { climb.add(1.0 * sin(it / 10.0)) } // ±1 m waves
        assertEquals(0.0, climb.gainM)
    }

    @Test
    fun whatTheAirDoesDuringAPauseIsNotAscent() {
        val climb = Climb()
        (0..20).forEach { climb.add(it.toDouble()) }
        climb.pause()
        (60..70).forEach { climb.add(it.toDouble()) }
        assertEquals(30.0, climb.gainM)
    }
}
