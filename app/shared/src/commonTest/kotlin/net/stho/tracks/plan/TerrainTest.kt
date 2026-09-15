package net.stho.tracks.plan

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.has
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.fail

/** The profile's measurements, pinned to `geo.ts` and `chart-theme.ts` by `terrain.json`. */
class TerrainTest {
    private val fixture = Fixtures.read("terrain.json")

    private fun JsonElement.nullableDoubles(): List<Double?> =
        jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.double }

    private fun assertAllClose(expected: List<Double?>, actual: List<Double?>, message: String) {
        assertEquals(expected.size, actual.size, "$message: length")
        expected.zip(actual).forEachIndexed { i, (e, a) ->
            if (e == null || a == null) {
                if (e != a) fail("$message[$i]: expected $e, got $a")
            } else {
                assertClose(e, a, "$message[$i]")
            }
        }
    }

    @Test
    fun measuresAsTheWebDoes() {
        for (case in fixture.cases("tracks")) {
            val name = case.string("name")
            val coordinates = case.getValue("coordinates").lonLats()
            val altitude = case.getValue("altitudeM").nullableDoubles()
            val reported = case.getValue("reportedM").let { if (it is JsonNull) null else it.jsonPrimitive.double }

            val distances = cumulativeDistances(coordinates, reported)
            assertAllClose(case.getValue("distances").doubles(), distances, "$name: distances")

            // Measured over the web's own distances, so a unit's rounding in a sine cannot move a window edge.
            val webDistances = case.getValue("distances").doubles()
            assertAllClose(case.getValue("gradients").nullableDoubles(), gradients(webDistances, altitude), "$name: gradients")

            val tolerance = case.getValue("tolerance").jsonPrimitive.double
            val cap = case.getValue("cap").jsonPrimitive.double
            assertEquals(case.getValue("drawn").ints(), drawnIndices(webDistances, altitude, tolerance, cap), "$name: drawn")
        }
    }

    @Test
    fun findsTheNearestAsTheWebDoes() {
        for (case in fixture.cases("nearest")) {
            val values = case.getValue("values").doubles()
            val target = case.getValue("target").jsonPrimitive.double
            assertEquals(case.getValue("index").jsonPrimitive.int, nearestInSorted(values, target), "$target in $values")
        }
    }

    @Test
    fun coloursGradientsAsTheWebDoes() {
        for (case in fixture.cases("grades")) {
            val gradient = case.getValue("gradient").jsonPrimitive.double
            val colour = case.string("colour").removePrefix("#").toInt(16)
            assertEquals(colour, gradeColour(gradient), "gradeColour($gradient)")
        }
    }

    @Test
    fun drawsNothingWithoutAltitude() {
        val flat = PlanTrack(listOf(net.stho.tracks.codec.Coordinate(47.0, 11.0), net.stho.tracks.codec.Coordinate(47.1, 11.0)), listOf(null, 700.0))
        assertNull(terrainOf(flat, null))
    }

    @Test
    fun theAxisSpansAtLeastTwoHundredMetres() {
        val track = PlanTrack(
            coordinates = List(50) { net.stho.tracks.codec.Coordinate(47.0 + it * 0.001, 11.0) },
            altitudeM = List(50) { 600.0 + it * 0.5 },
        )
        val terrain = terrainOf(track, null) ?: fail("a measured track draws")
        assertEquals(600.0, terrain.floorM)
        assertEquals(800.0, terrain.topM)
        if (!fixture.has("tracks")) fail("fixture")
    }
}
