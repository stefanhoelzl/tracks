package net.stho.tracks.ui.recording

import kotlin.test.Test
import kotlin.test.assertTrue
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.Tally
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.distanceM
import net.stho.tracks.sensors.pressureAt
import net.stho.tracks.ui.sensors.Gpx
import net.stho.tracks.ui.sensors.RideReplay
import okio.FileSystem
import okio.Path.Companion.toPath

/** The bundled Garmisch ride, recorded as the harness records it, against what its GPX says. */
class ReplayedRideTest {
    private val xml = FileSystem.SYSTEM.read("src/commonMain/composeResources/files/rides/garmisch.gpx".toPath()) { readUtf8() }

    @Test
    fun theTallyAgreesWithTheFile() {
        val points = Gpx.trackPoints(xml)
        val replay = RideReplay(points)
        val tally = Tally()
        replay.fixes.forEach { fix ->
            fix.altitudeM?.let { tally.add(Entry.Pressured(Pressure(pressureAt(it), fix.epochMillis))) }
            tally.add(Entry.Located(fix))
        }

        val fileDistance = points.zipWithNext().sumOf { (a, b) -> distanceM(a.at, b.at) }
        val fileRise = points.mapNotNull { it.elevationM }.zipWithNext().sumOf { (a, b) -> maxOf(0.0, b - a) }
        val moving = replay.fixes.count { (it.speedMps ?: 0.0) > 0 } * 1000L

        println(
            "garmisch: distance ${tally.odometer.distanceM} of $fileDistance m, moving ${tally.odometer.movingMillis} of $moving ms, " +
                "climbed ${tally.climb.gainM} of $fileRise m summed, elapsed ${replay.fixes.size} s",
        )
        assertTrue(tally.odometer.distanceM in fileDistance * 0.98..fileDistance * 1.001, "distance ${tally.odometer.distanceM} of $fileDistance")
        assertTrue(tally.odometer.movingMillis in moving - 2_000..moving, "moving ${tally.odometer.movingMillis} of $moving")
        assertTrue(tally.climb.gainM in fileRise * 0.8..fileRise, "climbed ${tally.climb.gainM} of $fileRise")
    }
}
