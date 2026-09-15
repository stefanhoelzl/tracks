package net.stho.tracks.ui.map

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.sensors.bearingDeg
import net.stho.tracks.sensors.distanceM

class InsetTargetTest {
    private val rider = Coordinate(47.4917, 11.0950)

    @Test
    fun noInsetAimsAtTheRider() {
        assertEquals(rider, insetTarget(rider, zoom = 13.0, bearingDeg = 0.0, downDp = 0.0, rightDp = 0.0))
    }

    @Test
    fun aSheetAtTheBottomAimsBelowTheRiderOnANorthUpMap() {
        val aim = insetTarget(rider, zoom = 13.0, bearingDeg = 0.0, downDp = 200.0, rightDp = 0.0)
        // 200 dp at zoom 13 and this latitude: 200 × 40 075 017 × cos(47.49°) / (512 × 8192) ≈ 1 291 m.
        assertEquals(1291.0, distanceM(rider, aim), 5.0)
        assertEquals(180.0, bearingDeg(rider, aim), 0.5)
    }

    @Test
    fun onATurnedMapDownTheScreenIsAgainstTheBearing() {
        val aim = insetTarget(rider, zoom = 13.0, bearingDeg = 90.0, downDp = 200.0, rightDp = 0.0)
        assertEquals(270.0, bearingDeg(rider, aim), 0.5)

        val aside = insetTarget(rider, zoom = 13.0, bearingDeg = 0.0, downDp = 0.0, rightDp = 100.0)
        assertTrue(aside.lon > rider.lon && kotlin.math.abs(aside.lat - rider.lat) < 1e-9)
    }
}
