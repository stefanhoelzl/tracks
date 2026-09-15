package net.stho.tracks.importing

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Precision 6 is lossless for GPS coordinates. */
const val IMPORT_PRECISION = 6

/**
 * The import frame from `packages/core/src/import.ts`: one activity, as `POST` sends it.
 *
 * [fromJson] accepts exactly what `importFrameSchema` accepts, so the phone refuses a frame
 * before the server would. That means Zod's rules, not Kotlin's: a key that is `null` is
 * present but a missing key is not; a string needs one UTF-16 unit; an integer is any safe
 * integer, whether or not it was written with a decimal point; unknown keys are dropped.
 *
 * [toJson] writes the keys in the schema's order. Numbers are not guaranteed to be spelled
 * the way `JSON.stringify` spells them (`12.0` against `12`), which no JSON reader notices.
 */
data class ImportFrame(
    val source: String,
    val externalId: String,
    val title: String?,
    /** UTC instant, ISO 8601. */
    val startedAt: String,
    val distanceM: Double?,
    /** Moving time. */
    val durationS: Long?,
    /** Wall clock, start to finish. */
    val elapsedS: Long?,
    val elevationGainM: Double?,
    val tags: List<String>,
    /** Full-resolution `[lat, lon]`, encoded at [IMPORT_PRECISION]. */
    val geometry: String,
    /** Metres above sea level, one per point, or null for a track with no elevation. */
    val altitudes: List<Double?>?,
    /** Seconds since [startedAt], one per point, or null for a track with no timing. */
    val times: List<Long?>?,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("source", source)
        put("externalId", externalId)
        put("title", title)
        put("startedAt", startedAt)
        put("distanceM", distanceM)
        put("durationS", durationS)
        put("elapsedS", elapsedS)
        put("elevationGainM", elevationGainM)
        put("tags", JsonArray(tags.map(::JsonPrimitive)))
        put("geometry", geometry)
        put("altitudes", altitudes?.let { values -> JsonArray(values.map { JsonPrimitive(it) }) } ?: JsonNull)
        put("times", times?.let { values -> JsonArray(values.map { JsonPrimitive(it) }) } ?: JsonNull)
    }

    fun encode(): String = toJson().toString()

    companion object {
        fun parse(json: String): ImportFrame = fromJson(Json.parseToJsonElement(json))

        /** Throws [IllegalArgumentException] naming the first field the schema would reject. */
        fun fromJson(element: JsonElement): ImportFrame {
            if (element !is JsonObject) invalid("frame", "expected an object")
            val fields = Fields(element)
            return ImportFrame(
                source = fields.string("source", min = 1),
                externalId = fields.string("externalId", min = 1),
                title = fields.nullable("title") { string(it, "title") },
                startedAt = fields.string("startedAt", min = 1),
                distanceM = fields.nullable("distanceM") { number(it, "distanceM") },
                durationS = fields.nullable("durationS") { integer(it, "durationS") },
                elapsedS = fields.nullable("elapsedS") { integer(it, "elapsedS") },
                elevationGainM = fields.nullable("elevationGainM") { number(it, "elevationGainM") },
                tags = array(fields.required("tags"), "tags").mapIndexed { i, e -> string(e, "tags[$i]") },
                geometry = fields.string("geometry", min = 1),
                altitudes = fields.nullable("altitudes") { value ->
                    array(value, "altitudes").mapIndexed { i, e ->
                        if (e is JsonNull) null else number(e, "altitudes[$i]")
                    }
                },
                times = fields.nullable("times") { value ->
                    array(value, "times").mapIndexed { i, e ->
                        if (e is JsonNull) null else integer(e, "times[$i]")
                    }
                },
            )
        }

        private class Fields(val obj: JsonObject) {
            fun required(key: String): JsonElement = obj[key] ?: invalid(key, "required")

            fun string(key: String, min: Int): String {
                val value = string(required(key), key)
                if (value.length < min) invalid(key, "must not be empty")
                return value
            }

            fun <T> nullable(key: String, read: (JsonElement) -> T): T? {
                val value = required(key)
                return if (value is JsonNull) null else read(value)
            }
        }

        private fun string(element: JsonElement, path: String): String {
            if (element !is JsonPrimitive || !element.isString) invalid(path, "expected a string")
            return element.content
        }

        private fun number(element: JsonElement, path: String): Double {
            if (element !is JsonPrimitive || element.isString || element is JsonNull) invalid(path, "expected a number")
            val value = element.content.toDoubleOrNull() ?: invalid(path, "expected a number")
            if (!value.isFinite()) invalid(path, "expected a finite number")
            return value
        }

        private fun integer(element: JsonElement, path: String): Long {
            val value = number(element, path)
            if (value % 1.0 != 0.0 || value < -MAX_SAFE_INTEGER || value > MAX_SAFE_INTEGER) {
                invalid(path, "expected a safe integer")
            }
            return value.toLong()
        }

        private fun array(element: JsonElement, path: String): JsonArray =
            element as? JsonArray ?: invalid(path, "expected an array")

        private fun invalid(path: String, reason: String): Nothing =
            throw IllegalArgumentException("import frame: $path: $reason")

        private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
    }
}
