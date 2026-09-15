package net.stho.tracks.ui.sensors

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.shareIn
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

/**
 * These sensors, collected once however many things read them: the map and the recorder see the same fix, from one
 * CoreLocation manager — and from one replay, which, collected twice, would be two rides started at different moments.
 */
fun Sensors.shared(scope: CoroutineScope): Sensors {
    val source = this
    return object : Sensors {
        override val fixes = source.fixes.shareIn(scope, SharingStarted.WhileSubscribed(), replay = 1)
        override val headings = source.headings.shareIn(scope, SharingStarted.WhileSubscribed(), replay = 1)
        override val pressures = source.pressures.shareIn(scope, SharingStarted.WhileSubscribed(), replay = 1)
    }
}
