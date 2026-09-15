package net.stho.tracks.importing

import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import net.stho.tracks.Fixtures
import net.stho.tracks.assertJsonEquals
import net.stho.tracks.cases
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ImportFrameTest {
    private val fixture = Fixtures.read("import.json")

    @Test
    fun acceptsWhatTheSchemaAcceptsAndRefusesTheRest() {
        for (case in fixture.cases("frames")) {
            val name = case.string("name")
            val input = case.getValue("input")
            if (case.getValue("valid").jsonPrimitive.boolean) {
                val frame = ImportFrame.fromJson(input)
                assertJsonEquals(case.getValue("output"), frame.toJson(), name)
                assertEquals(frame, ImportFrame.parse(frame.encode()), "$name: round trip")
            } else {
                assertFailsWith<IllegalArgumentException>(name) { ImportFrame.fromJson(input) }
            }
        }
    }

    @Test
    fun encodesGeometryAtTheWebsPrecision() {
        assertEquals(fixture.getValue("IMPORT_PRECISION").jsonPrimitive.long, IMPORT_PRECISION.toLong())
    }
}
