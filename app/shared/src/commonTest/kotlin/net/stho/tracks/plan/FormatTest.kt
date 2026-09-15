package net.stho.tracks.plan

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.int
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals

/** A plan's numbers, pinned to `packages/web/src/lib/format.ts` by `format.json`. */
class FormatTest {
    private val fixture = Fixtures.read("format.json")

    private fun kotlinx.serialization.json.JsonObject.value(): Double? =
        getValue("value").let { if (it is JsonNull) null else it.jsonPrimitive.double }

    @Test
    fun printsDistancesAsTheWebDoes() {
        for (case in fixture.cases("km")) {
            val digits = case.int("digits")
            assertEquals(case.string("text"), Format.km(case.value(), digits), "km(${case.value()}, $digits)")
        }
    }

    @Test
    fun printsHeightsAsTheWebDoes() {
        for (case in fixture.cases("metres")) {
            assertEquals(case.string("text"), Format.metres(case.value()), "metres(${case.value()})")
        }
    }

    @Test
    fun printsDurationsAsTheWebDoes() {
        for (case in fixture.cases("durations")) {
            assertEquals(case.string("text"), Format.duration(case.value()), "duration(${case.value()})")
        }
    }
}
