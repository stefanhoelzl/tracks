package net.stho.tracks.plan

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.cases
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/**
 * The profile's axes, its figures and its split, pinned to `lib/profile.ts` by `profile.json`.
 *
 * A failure here is the phone drawing a ride against a different scale than the browser, or reporting a different climb
 * for the stretch between the same two bars. Regenerate with `pnpm fixtures:app` after changing either side.
 */
class ProfileTest {
    private val fixture = Fixtures.read("profile.json")

    private fun JsonElement.nullableDoubles(): List<Double?> =
        jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.double }

    private fun JsonElement.axis(): Axis = jsonObject.let {
        Axis(
            min = it.getValue("min").jsonPrimitive.double,
            max = it.getValue("max").jsonPrimitive.double,
            step = it.getValue("step").jsonPrimitive.double,
            values = it.getValue("values").doubles(),
        )
    }

    private fun assertAxis(expected: Axis, actual: Axis, message: String) {
        assertClose(expected.min, actual.min, "$message: min")
        assertClose(expected.max, actual.max, "$message: max")
        assertClose(expected.step, actual.step, "$message: step")
        assertEquals(expected.values.size, actual.values.size, "$message: label count")
        expected.values.zip(actual.values).forEachIndexed { i, (e, a) -> assertClose(e, a, "$message: value $i") }
    }

    private fun JsonElement.stats(): Stats = jsonObject.let {
        Stats(
            distanceM = it.getValue("distanceM").jsonPrimitive.double,
            ascentM = it.getValue("ascentM").jsonPrimitive.double,
            descentM = it.getValue("descentM").jsonPrimitive.double,
        )
    }

    private fun assertStats(expected: Stats, actual: Stats, message: String) {
        assertClose(expected.distanceM, actual.distanceM, "$message: distance")
        assertClose(expected.ascentM, actual.ascentM, "$message: ascent")
        assertClose(expected.descentM, actual.descentM, "$message: descent")
    }

    @Test
    fun scalesHeightAsTheWebDoes() {
        for (case in fixture.cases("axes")) {
            val lowM = case.getValue("lowM").jsonPrimitive.double
            val highM = case.getValue("highM").jsonPrimitive.double
            val minSpanM = case.getValue("minSpanM").jsonPrimitive.double
            assertAxis(case.getValue("axis").axis(), heightAxis(lowM, highM, minSpanM), "height $lowM–$highM/$minSpanM")
        }
    }

    @Test
    fun scalesDistanceAsTheWebDoes() {
        for (case in fixture.cases("distances")) {
            val totalM = case.getValue("totalM").jsonPrimitive.double
            assertAxis(case.getValue("axis").axis(), distanceAxis(totalM), "distance $totalM")
        }
    }

    @Test
    fun readsTheSameFiguresOffTheSameTrack() {
        for (case in fixture.cases("tracks")) {
            val name = case.string("name")
            val distances = case.getValue("distances").doubles()
            val altitudeM = case.getValue("altitudeM").nullableDoubles()

            for (height in case.cases("altitudes")) {
                val alongM = height.getValue("alongM").jsonPrimitive.double
                val expected = height.getValue("altitudeM").let { if (it is JsonNull) null else it.jsonPrimitive.double }
                val actual = altitudeAt(distances, altitudeM, alongM)
                when {
                    expected == null || actual == null ->
                        if (expected != actual) fail("$name: altitude at $alongM: expected $expected, got $actual")
                    else -> assertClose(expected, actual, "$name: altitude at $alongM")
                }
            }

            for (range in case.cases("ranges")) {
                val fromM = range.getValue("fromM").jsonPrimitive.double
                val toM = range.getValue("toM").jsonPrimitive.double
                assertStats(range.getValue("stats").stats(), statsBetween(distances, altitudeM, fromM, toM), "$name: $fromM→$toM")
            }

            for (slice in case.cases("slices")) {
                val fromM = slice.getValue("fromM").jsonPrimitive.double
                val toM = slice.getValue("toM").jsonPrimitive.double
                // The same synthetic geometry the fixture laid along the distances.
                val points = distances.map { Coordinate(11 + it / 100_000, 47 + it / 200_000) }
                val expected = slice.getValue("points").jsonArray.map { it.jsonArray }
                val actual = sliceBetween(points, distances, fromM, toM)
                assertEquals(expected.size, actual.size, "$name: slice $fromM→$toM length")
                expected.zip(actual).forEachIndexed { i, (e, a) ->
                    assertClose(e[0].jsonPrimitive.double, a.lat, "$name: slice $fromM→$toM point $i lat")
                    assertClose(e[1].jsonPrimitive.double, a.lon, "$name: slice $fromM→$toM point $i lon")
                }
            }

            for (split in case.cases("splits")) {
                val atM = split.getValue("atM").jsonPrimitive.double
                val expected = split.getValue("split").jsonObject
                val actual = splitAt(distances, altitudeM, atM)
                assertStats(expected.getValue("done").stats(), actual.done, "$name: done by $atM")
                assertStats(expected.getValue("toCome").stats(), actual.toCome, "$name: to come after $atM")
            }
        }
    }
}
