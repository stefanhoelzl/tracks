package net.stho.tracks.ui.map

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading

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

    @Test
    fun theCompassTurnsTheMapOnlyWhereMapBearingUsesIt() {
        assertTrue(compassTurnsMap(Orientation.HeadingUp, fix(90.0, 3.9)))
        assertTrue(compassTurnsMap(Orientation.HeadingUp, fix(null, 18.0)))
        assertTrue(compassTurnsMap(Orientation.HeadingUp, null))
        assertFalse(compassTurnsMap(Orientation.HeadingUp, fix(90.0, 4.0)))
        assertFalse(compassTurnsMap(Orientation.NorthUp, fix(null, 0.0)))
    }

    @Test
    fun whereTheCompassDoesNotTurnTheMapTheHeadingChangesNothing() {
        val fixes = listOf(fix(90.0, 18.0), fix(90.0, 4.0), fix(90.0, 3.9), fix(null, 0.0), null)
        for (orientation in Orientation.entries) for (at in fixes) {
            if (compassTurnsMap(orientation, at)) continue
            assertEquals(mapBearing(orientation, at, compass, previous = 10.0), mapBearing(orientation, at, null, previous = 10.0))
        }
    }
}
