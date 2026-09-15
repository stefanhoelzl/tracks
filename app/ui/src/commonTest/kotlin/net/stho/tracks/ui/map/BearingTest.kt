package net.stho.tracks.ui.map

import kotlin.test.Test
import kotlin.test.assertEquals
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.sensors.Fix
import net.stho.tracks.ui.sensors.Heading

class BearingTest {
    private fun fix(courseDeg: Double?, kmh: Double) =
        Fix(Coordinate(47.5, 11.1), 700.0, courseDeg, kmh / 3.6, 5.0, 0)

    private val compass = Heading(200.0, 0)

    @Test
    fun movingFollowsTheCourse() {
        assertEquals(90.0, mapBearing(Orientation.HeadingUp, fix(90.0, 18.0), compass, previous = 10.0))
        assertEquals(90.0, mapBearing(Orientation.HeadingUp, fix(90.0, 4.0), compass, previous = 10.0))
    }

    @Test
    fun slowFollowsTheCompass() {
        assertEquals(200.0, mapBearing(Orientation.HeadingUp, fix(90.0, 3.9), compass, previous = 10.0))
        assertEquals(200.0, mapBearing(Orientation.HeadingUp, fix(null, 0.0), compass, previous = 10.0))
        assertEquals(200.0, mapBearing(Orientation.HeadingUp, null, compass, previous = 10.0))
    }

    @Test
    fun withNeitherItStaysWhereItWas() {
        assertEquals(10.0, mapBearing(Orientation.HeadingUp, fix(null, 0.0), null, previous = 10.0))
        assertEquals(10.0, mapBearing(Orientation.HeadingUp, null, null, previous = 10.0))
    }

    @Test
    fun northUpIsNorthUp() {
        assertEquals(0.0, mapBearing(Orientation.NorthUp, fix(90.0, 18.0), compass, previous = 10.0))
    }
}
