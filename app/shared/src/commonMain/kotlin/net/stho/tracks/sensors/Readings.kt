package net.stho.tracks.sensors

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import net.stho.tracks.codec.Coordinate

/*
 * What the phone senses, as values. Here rather than beside the flows that deliver them (:ui's `Sensors`), because
 * recording reads them too, and recording is plain Kotlin that the native Linux target tests.
 */

/** One position fix, as the app reads it, whichever source it came from. */
data class Fix(
    val at: Coordinate,
    val altitudeM: Double?,
    /** The direction of travel, degrees clockwise from true north. Null when the source has none, as a GPS standing still. */
    val courseDeg: Double?,
    val speedMps: Double?,
    val accuracyM: Double?,
    val epochMillis: Long,
)

/** Where the phone points, degrees clockwise from true north. */
data class Heading(val degrees: Double, val epochMillis: Long)

/** Air pressure, hPa. */
data class Pressure(val hPa: Double, val epochMillis: Long)

private const val EARTH_RADIUS_M = 6_371_000.0

private fun Double.radians() = this * PI / 180.0

/** Metres between two coordinates, on a sphere. */
fun distanceM(a: Coordinate, b: Coordinate): Double {
    val dLat = (b.lat - a.lat).radians()
    val dLon = (b.lon - a.lon).radians()
    val h = sin(dLat / 2).pow(2) + cos(a.lat.radians()) * cos(b.lat.radians()) * sin(dLon / 2).pow(2)
    return 2 * EARTH_RADIUS_M * atan2(sqrt(h), sqrt(1 - h))
}

private const val SEA_LEVEL_HPA = 1013.25
private const val LAPSE = 2.25577e-5
private const val EXPONENT = 5.25588

/** What a barometer reads at an altitude in the standard atmosphere, hPa. */
fun pressureAt(altitudeM: Double): Double = SEA_LEVEL_HPA * (1 - LAPSE * altitudeM).pow(EXPONENT)

/**
 * The altitude a pressure reads as in the standard atmosphere: [pressureAt] backwards.
 *
 * Off by the weather — tens of metres, and drifting through a day — but a climb is a difference, and a difference
 * over minutes is what a barometer gets right.
 */
fun altitudeAt(hPa: Double): Double = (1 - (hPa / SEA_LEVEL_HPA).pow(1 / EXPONENT)) / LAPSE
