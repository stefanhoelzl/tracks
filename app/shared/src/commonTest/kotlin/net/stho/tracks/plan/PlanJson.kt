package net.stho.tracks.plan

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.string
import kotlin.math.abs
import kotlin.math.max
import kotlin.test.fail

/* The web's plans, waypoints and legs, as the fixtures carry them. */

internal fun JsonElement.stringOrNull(): String? = if (this is JsonNull) null else jsonPrimitive.content

internal fun JsonElement.intOrNull(): Int? = if (this is JsonNull) null else jsonPrimitive.int

internal fun JsonElement.ints(): List<Int> = jsonArray.map { it.jsonPrimitive.int }

internal fun JsonElement.doubles(): List<Double> = jsonArray.map { it.jsonPrimitive.double }

internal fun JsonElement.waypoint(): Waypoint = jsonObject.let {
    Waypoint(
        lat = it.getValue("lat").jsonPrimitive.double,
        lon = it.getValue("lon").jsonPrimitive.double,
        kind = if (it.string("kind") == "poi") WaypointKind.Poi else WaypointKind.Routing,
        name = it.getValue("name").stringOrNull(),
    )
}

internal fun JsonElement.waypoints(): List<Waypoint> = jsonArray.map { it.waypoint() }

internal fun JsonElement.plan(): Plan = jsonObject.let {
    Plan(
        name = it.string("name"),
        profile = Profile.of(it.string("profile")) ?: fail("unknown profile in fixture: $it"),
        waypoints = it.getValue("waypoints").waypoints(),
    )
}

/** `{lat, lon}`, as a tap or a place is written. */
internal fun JsonElement.latLon(): Coordinate =
    jsonObject.let { Coordinate(it.getValue("lat").jsonPrimitive.double, it.getValue("lon").jsonPrimitive.double) }

/** `[lon, lat]`, as GeoJSON and every leg write it. */
internal fun JsonElement.lonLat(): Coordinate =
    jsonArray.let { Coordinate(lat = it[1].jsonPrimitive.double, lon = it[0].jsonPrimitive.double) }

internal fun JsonElement.lonLats(): List<Coordinate> = jsonArray.map { it.lonLat() }

internal fun JsonElement.leg(): Leg? {
    if (this is JsonNull) return null
    val leg = jsonObject
    val from = leg.getValue("from").waypoint()
    val to = leg.getValue("to").waypoint()
    if (!leg.getValue("ok").jsonPrimitive.boolean) return FailedLeg(from, to, leg.string("reason"))
    return RoutedLeg(
        from = from,
        to = to,
        coordinates = leg.getValue("coordinates").lonLats(),
        altitudeM = leg.getValue("altitudeM").doubles(),
        distanceM = leg.getValue("distanceM").jsonPrimitive.double,
        ascentM = leg.getValue("ascentM").jsonPrimitive.double,
        descentM = leg.getValue("descentM").jsonPrimitive.double,
        durationS = leg.getValue("durationS").jsonPrimitive.double,
    )
}

internal fun JsonElement.legs(): List<Leg?> = jsonArray.map { it.leg() }

internal fun JsonElement.totals(): PlanTotals = jsonObject.let {
    PlanTotals(
        distanceM = it.getValue("distanceM").jsonPrimitive.double,
        ascentM = it.getValue("ascentM").jsonPrimitive.double,
        descentM = it.getValue("descentM").jsonPrimitive.double,
        durationS = it.getValue("durationS").jsonPrimitive.double,
        incomplete = it.getValue("incomplete").jsonPrimitive.boolean,
    )
}

/** For what goes through a cosine, which JavaScript's engines and Kotlin's platforms may round a unit apart. */
internal fun assertClose(expected: Double, actual: Double, message: String) {
    if (abs(expected - actual) > 1e-9 * max(1.0, abs(expected))) fail("$message: expected $expected, got $actual")
}
