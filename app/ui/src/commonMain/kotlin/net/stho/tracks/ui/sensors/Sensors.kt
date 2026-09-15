package net.stho.tracks.ui.sensors

import kotlinx.coroutines.flow.Flow
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure

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

