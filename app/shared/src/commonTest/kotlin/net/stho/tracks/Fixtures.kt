package net.stho.tracks

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.codec.Coordinate
import kotlin.test.assertEquals
import kotlin.test.fail

internal expect fun environment(name: String): String?

internal expect fun readText(path: String): String

/**
 * The fixtures `pnpm fixtures:app` generates from the TypeScript. They are the reference;
 * these tests only ever read them.
 */
internal object Fixtures {
    private val dir: String
        get() = environment("TRACKS_APP_FIXTURES")
            ?: error("TRACKS_APP_FIXTURES is not set — run the tests through Gradle")

    fun read(name: String): JsonObject = Json.parseToJsonElement(readText("$dir/$name")).jsonObject

    /** A recorded answer elsewhere in the repository, by the path relative to its root that a fixture names. */
    fun repoText(path: String): String = readText("$dir/../../../../../$path")
}

internal fun JsonObject.cases(key: String): List<JsonObject> = getValue(key).jsonArray.map { it.jsonObject }

internal fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

internal fun JsonObject.int(key: String): Int = getValue(key).jsonPrimitive.int

internal fun JsonObject.has(key: String): Boolean = containsKey(key)

internal fun JsonElement.coordinates(): List<Coordinate> =
    jsonArray.map { pair -> pair.jsonArray.let { Coordinate(it[0].jsonPrimitive.double, it[1].jsonPrimitive.double) } }

/** Doubles compared with `==`, so -0.0 and 0.0 agree, as they do once JSON has carried them. */
internal fun assertCoordinatesEqual(expected: List<Coordinate>, actual: List<Coordinate>, message: String) {
    assertEquals(expected.size, actual.size, "$message: length")
    expected.zip(actual).forEachIndexed { i, (e, a) ->
        if (e.lat != a.lat || e.lon != a.lon) fail("$message: point $i expected $e, got $a")
    }
}

/** Structural JSON equality: same keys in the same order, numbers equal as doubles. */
internal fun assertJsonEquals(expected: JsonElement, actual: JsonElement, path: String = "$") {
    when (expected) {
        is JsonObject -> {
            if (actual !is JsonObject) fail("$path: expected an object, got $actual")
            assertEquals(expected.keys.toList(), actual.keys.toList(), "$path: keys")
            for (key in expected.keys) assertJsonEquals(expected.getValue(key), actual.getValue(key), "$path.$key")
        }
        is JsonArray -> {
            if (actual !is JsonArray) fail("$path: expected an array, got $actual")
            assertEquals(expected.size, actual.size, "$path: length")
            expected.zip(actual).forEachIndexed { i, (e, a) -> assertJsonEquals(e, a, "$path[$i]") }
        }
        is JsonNull -> if (actual !is JsonNull) fail("$path: expected null, got $actual")
        is JsonPrimitive -> {
            if (actual !is JsonPrimitive || actual is JsonNull) fail("$path: expected $expected, got $actual")
            if (expected.isString) {
                assertEquals(expected, actual, path)
            } else {
                val e = expected.content.toDoubleOrNull()
                val a = actual.content.toDoubleOrNull()
                if (e == null) assertEquals(expected.content, actual.content, path)
                else if (e != a) fail("$path: expected $e, got ${actual.content}")
            }
        }
    }
}
