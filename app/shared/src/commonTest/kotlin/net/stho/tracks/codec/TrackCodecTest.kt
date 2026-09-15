package net.stho.tracks.codec

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.double
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.has
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.fail

class TrackCodecTest {
    private val fixture = Fixtures.read("track-codec.json")

    @Test
    fun encodesTheCharactersTheWebEncodes() {
        for (case in fixture.cases("encode")) {
            val values = case.getValue("values").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.long }
            assertEquals(case.string("encoded"), TrackCodec.encodeScalars(values), "$values")
        }
    }

    @Test
    fun decodesOrRefusesAsTheWebDoes() {
        for (case in fixture.cases("decode")) {
            val encoded = case.string("encoded")
            if (case.has("error")) {
                val error = assertFailsWith<IllegalArgumentException>("\"$encoded\"") { TrackCodec.decodeScalars(encoded) }
                assertEquals(case.string("error"), error.message, "\"$encoded\"")
            } else {
                val expected = case.getValue("values").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.long }
                assertEquals(expected, TrackCodec.decodeScalars(encoded), "\"$encoded\"")
            }
        }
    }

    @Test
    fun scalesAltitudesAsTheWebDoes() {
        for (case in fixture.cases("altitudesToScalars")) {
            val metres = case.getValue("metres").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.double }
            val expected = case.getValue("scalars").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.long }
            assertEquals(expected, TrackCodec.altitudesToScalars(metres), "$metres")
        }
        for (case in fixture.cases("altitudesFromScalars")) {
            val scalars = case.getValue("scalars").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.long }
            val expected = case.getValue("metres").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.double }
            val actual = TrackCodec.altitudesFromScalars(scalars)
            assertEquals(expected.size, actual.size, "$scalars")
            expected.zip(actual).forEach { (e, a) -> if (e != a) fail("$scalars: expected $expected, got $actual") }
        }
    }

    @Test
    fun theTrackPrecisionIsTheWebs() {
        assertEquals(fixture.getValue("TRACK_PRECISION").jsonPrimitive.long, TRACK_PRECISION.toLong())
        assertEquals(fixture.getValue("ALTITUDE_SCALE").jsonPrimitive.long, ALTITUDE_SCALE.toLong())
    }
}
