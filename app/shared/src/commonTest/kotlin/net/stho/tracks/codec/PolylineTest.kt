package net.stho.tracks.codec

import net.stho.tracks.Fixtures
import net.stho.tracks.assertCoordinatesEqual
import net.stho.tracks.cases
import net.stho.tracks.coordinates
import net.stho.tracks.int
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals

class PolylineTest {
    private val fixture = Fixtures.read("polyline.json")

    @Test
    fun encodesTheCharactersTheWebEncodes() {
        for (case in fixture.cases("encode")) {
            val precision = case.int("precision")
            val points = case.getValue("points").coordinates()
            assertEquals(case.string("encoded"), Polyline.encode(points, precision), "precision $precision: $points")
        }
    }

    @Test
    fun decodesToTheNumbersTheWebDecodes() {
        for (case in fixture.cases("decode")) {
            val encoded = case.string("encoded")
            val precision = case.int("precision")
            assertCoordinatesEqual(
                case.getValue("points").coordinates(),
                Polyline.decode(encoded, precision),
                "precision $precision: \"$encoded\"",
            )
        }
    }
}
