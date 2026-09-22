package net.stho.tracks.ui.measure

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MeasureLaunchTest {
    @AfterTest
    fun reset() {
        Ablation.current = null
        applyMeasureOverrides { null }
    }

    @Test
    fun aLaunchWithoutALabelIsNotMeasuredAndSetsNothing() {
        val env = mapOf("TRACKS_ABLATE" to "NoMap", "TRACKS_MAX_FPS" to "4")
        assertNull(configureMeasurement(env::get))
        assertNull(Ablation.current)
        assertNull(MeasureOverrides.maxFps)
    }

    @Test
    fun aMeasuredLaunchReadsEverySwitch() {
        val env = mapOf(
            "TRACKS_RIDE_MEASURE" to "cap-off", "TRACKS_SEED" to "15000", "TRACKS_GPX" to "ride.gpx",
            "TRACKS_ABLATE" to "staticcamera", "TRACKS_MAX_FPS" to "0", "TRACKS_FOLLOW_MS" to "950",
            "TRACKS_HEADING_FILTER" to "1", "TRACKS_RIDING_ZOOM" to "15.0", "TRACKS_HEADING_HZ" to "30",
            "TRACKS_REAL_HEADING" to "1",
        )
        val launch = configureMeasurement(env::get)!!
        assertEquals("cap-off", launch.label)
        assertEquals(15000, launch.seed)
        assertEquals("ride.gpx", launch.gpx)
        assertEquals(30.0, launch.headingHz)
        assertEquals(3.0, launch.headingJitter)
        assertTrue(launch.realHeading)
        assertFalse(launch.realSensors)
        assertEquals(Ablation.StaticCamera, Ablation.current)
        assertEquals(0, MeasureOverrides.maxFps)
        assertEquals(950L, MeasureOverrides.followMs)
        assertEquals(1.0, MeasureOverrides.headingFilter)
        assertEquals(15.0, MeasureOverrides.ridingZoom)
    }

    @Test
    fun framesAreNotCountedUnlessAskedFor() {
        assertFalse(configureMeasurement(mapOf("TRACKS_RIDE_MEASURE" to "a")::get)!!.countFrames)
        assertTrue(configureMeasurement(mapOf("TRACKS_RIDE_MEASURE" to "a", "TRACKS_RIDE_FRAMES" to "1")::get)!!.countFrames)
    }
}
