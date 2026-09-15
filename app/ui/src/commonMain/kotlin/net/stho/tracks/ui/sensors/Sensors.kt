package net.stho.tracks.ui.sensors

import kotlinx.coroutines.flow.Flow
import net.stho.tracks.codec.Coordinate

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

/**
 * Everything the app senses, behind one interface: a replayed ride on the desktop, CoreLocation on the phone.
 *
 * Each flow starts its source when collected and stops it when the collector is cancelled, so a screen that
 * is not showing costs nothing.
 */
interface Sensors {
    val fixes: Flow<Fix>
    val headings: Flow<Heading>

    /** The phone's barometer arrives with recording (M15); until then only the replay has one. */
    val pressures: Flow<Pressure>
}
