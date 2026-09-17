package net.stho.tracks.recording

import kotlin.math.PI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.codec.Polyline
import net.stho.tracks.importing.IMPORT_PRECISION
import net.stho.tracks.importing.ImportFrame
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.pressureAt

class RideFrameTest {
    private val t0 = 1_783_062_000_400L
    private val metre = 1.0 / (6_371_000.0 * PI / 180.0)

    /** Two minutes north at 5 m/s, climbing 0.5 m a second; GPS altitude 12 m above the standard atmosphere, 40 m out every ten seconds. */
    private fun ride(barometer: Boolean = true, gps: Boolean = true, saved: Boolean = true): Ride {
        val entries = mutableListOf<Entry>(Entry.Started("5f0e", t0 - 3000, null, null))
        for (s in 0..120) {
            val altitude = 600 + s * 0.5
            if (barometer) entries += Entry.Pressured(Pressure(pressureAt(altitude), t0 + s * 1000L - 200))
            val gpsAltitude = (altitude + 12 + (if (s % 10 == 5) 40 else 0)).takeIf { gps }
            entries += Entry.Located(Fix(Coordinate(47.0 + s * 5 * metre, 11.0), gpsAltitude, 0.0, 5.0, 4.0, t0 + s * 1000L))
        }
        entries += Entry.Stopped(t0 + 121_000)
        if (saved) entries += Entry.Saved("Ride on 3 July", "bike")
        return Ride(entries)
    }

    @Test
    fun aSavedRideIsAFrameTheSchemaAccepts() {
        val frame = RideFrame.of(ride())
        assertEquals(frame, ImportFrame.parse(frame.encode()))

        assertEquals("tracks", frame.source)
        assertEquals("5f0e", frame.externalId)
        assertEquals("Ride on 3 July", frame.title)
        assertEquals(listOf("sport:bike"), frame.tags)
        assertEquals("2026-07-03T07:00:00Z", frame.startedAt)
        assertEquals(600.0, frame.distanceM)
        assertEquals(120L, frame.durationS)
        assertEquals(120L, frame.elapsedS)
        assertEquals(60.0, frame.elevationGainM)
        assertEquals((0..120).map { it.toLong() }, frame.times)
        assertEquals(121, Polyline.decode(frame.geometry, IMPORT_PRECISION).size)
    }

    @Test
    fun altitudeIsTheBarometerAnchoredToGpsAndRoundedToAMetre() {
        val altitudes = RideFrame.of(ride()).altitudes!!
        // The barometer's line, moved up by GPS's median offset — 12 m, its outliers ignored — to whole metres.
        assertEquals(612.0, altitudes.first())
        altitudes.forEach { assertEquals(kotlin.math.round(it!!), it) }
        assertEquals(672.0, altitudes.last())
    }

    @Test
    fun withoutABarometerThereIsNoAscentAndAltitudeIsGps() {
        val frame = RideFrame.of(ride(barometer = false))
        assertNull(frame.elevationGainM)
        assertEquals(612.0, frame.altitudes!!.first())
        assertEquals(655.0, frame.altitudes!![5])

        assertNull(RideFrame.of(ride(barometer = false, gps = false)).altitudes)
    }

    @Test
    fun onlyASavedRideWithFixesIsAFrame() {
        assertFailsWith<IllegalArgumentException> { RideFrame.of(ride(saved = false)) }
        assertFailsWith<IllegalArgumentException> {
            RideFrame.of(Ride(listOf(Entry.Started("x", t0, null, null), Entry.Stopped(t0), Entry.Saved("x", "bike"))))
        }
    }

    @Test
    fun theSportComesFromThePlansProfile() {
        assertEquals(listOf("bike", "bike", "bike", "bike", "hike", "bike"), listOf("road", "trekking", "gravel", "mtb", "hiking", null).map(::sportFor))
        assertFalse("run" in listOf("road", "trekking", "gravel", "mtb", "hiking", null).map(::sportFor), "a run is only chosen by hand")
        assertEquals(listOf("bike", "hike", "run"), SPORTS)
    }
}
