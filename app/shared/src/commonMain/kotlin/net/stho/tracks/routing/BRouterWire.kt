package net.stho.tracks.routing

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.codec.jsNumberToString
import net.stho.tracks.codec.jsStringToNumber
import net.stho.tracks.codec.jsTrim
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.descentOf

/**
 * The engine is missing data, refusing, or answered something unrecognisable — a fact about the router, not a leg that
 * cannot be routed, which is a [net.stho.tracks.plan.FailedLeg].
 */
open class RouterError(message: String) : Exception(message)

/** A tile this leg needs is not on the device yet. The leg stays as it is until it is. */
class NoRoutingData(val segment: String) : RouterError("no routing data on this device for $segment")

/**
 * BRouter's request and answer, from `packages/routing/src/brouter/index.ts`.
 *
 * The web sends it to brouter.de and the phone to the engine, and both answer with the same GeoJSON, so both are
 * written and read by one set of rules. Pinned by `brouter.json`.
 */
internal object BRouterWire {
    /** Their filenames for our five words. */
    fun profileFile(profile: Profile): String = when (profile) {
        Profile.Road -> "fastbike"
        Profile.Trekking -> "trekking"
        Profile.Gravel -> "gravel"
        Profile.Mtb -> "mtb"
        Profile.Hiking -> "hiking-mountain"
    }

    /** `lonlats` is delimited by commas and pipes, so a name carrying either would rewrite the request. */
    private fun wireName(name: String): String = jsTrim(name.replace(Regex("[,;|]"), " "))

    /** A named point is a via, a bare one shaping, and a POI with no name yet `m`, BRouter's unnamed via. */
    private fun wirePoint(waypoint: Waypoint): String {
        val at = "${jsNumberToString(waypoint.lon)},${jsNumberToString(waypoint.lat)}"
        if (waypoint.kind != WaypointKind.Poi) return at
        val name = waypoint.name?.let(::wireName) ?: ""
        return if (name == "") "$at,m" else "$at,$name"
    }

    fun lonlats(stretch: List<Waypoint>): String = stretch.joinToString("|", transform = ::wirePoint)

    /** Reads a leg off BRouter's GeoJSON, or throws [RouterError] when it is not a track BRouter would send. */
    fun leg(from: Waypoint, to: Waypoint, body: String): RoutedLeg {
        val track = readTrack(Json.parseToJsonElement(body)) ?: throw RouterError("BRouter sent an unrecognised track")

        val coordinates = ArrayList<Coordinate>(track.points.size)
        val altitudeM = ArrayList<Double>(track.points.size)
        for (point in track.points) {
            coordinates.add(Coordinate(lat = point[1], lon = point[0]))
            altitudeM.add(point.getOrNull(2) ?: 0.0)
        }

        return RoutedLeg(
            from = from,
            to = to,
            coordinates = coordinates,
            altitudeM = altitudeM,
            distanceM = track.lengthM,
            ascentM = track.ascentM,
            descentM = descentOf(track.ascentM, altitudeM),
            durationS = track.timeS,
        )
    }

    private class Track(val points: List<List<Double>>, val lengthM: Double, val ascentM: Double, val timeS: Double)

    /*
     * The web's zod schema, by hand: every feature must be a track, though only the first is read, and BRouter's
     * numbers-as-strings are coerced as `z.coerce.number()` does — through JavaScript's Number(), finite or refused.
     */

    private fun readTrack(root: JsonElement): Track? {
        if (root !is JsonObject || root["type"].string() != "FeatureCollection") return null
        val features = root["features"] as? JsonArray ?: return null
        if (features.isEmpty()) return null
        val tracks = features.map { readFeature(it) ?: return null }
        return tracks.first()
    }

    private fun readFeature(element: JsonElement): Track? {
        val feature = element as? JsonObject ?: return null
        val geometry = feature["geometry"] as? JsonObject ?: return null
        if (geometry["type"].string() != "LineString") return null
        val coordinates = geometry["coordinates"] as? JsonArray ?: return null
        val points = coordinates.map { point ->
            val values = point as? JsonArray ?: return null
            if (values.size < 2) return null
            values.map { it.number() ?: return null }
        }

        val properties = feature["properties"] as? JsonObject ?: return null
        return Track(
            points = points,
            lengthM = coerce(properties["track-length"]) ?: return null,
            ascentM = coerce(properties["filtered ascend"]) ?: return null,
            timeS = coerce(properties["total-time"]) ?: return null,
        )
    }

    private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonElement.number(): Double? {
        if (this !is JsonPrimitive || this is JsonNull || isString || booleanOrNull != null) return null
        return content.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    private fun coerce(element: JsonElement?): Double? {
        val number = when {
            element == null -> return null
            element is JsonNull -> 0.0
            element !is JsonPrimitive -> return null
            element.isString -> jsStringToNumber(element.content)
            element.booleanOrNull != null -> if (element.booleanOrNull == true) 1.0 else 0.0
            else -> element.content.toDoubleOrNull() ?: return null
        }
        return number.takeIf { it.isFinite() }
    }
}
