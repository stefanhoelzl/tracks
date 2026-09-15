package net.stho.tracks.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.window.ComposeUIViewController
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.harness.MapHarness
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.sensors.LocationSensors
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.Sensors
import platform.Foundation.NSProcessInfo
import platform.UIKit.UIViewController

/**
 * The app's screen, for the Swift shell to put in its window.
 *
 * It follows the phone's own location and compass. Launched with TRACKS_REPLAY=<second> (`pymobiledevice3 developer
 * dvt launch --env`), it replays the bundled ride from that second instead — the same ride the desktop harness and the
 * screenshot tests draw, which is how the three are compared.
 */
fun MainViewController(): UIViewController = ComposeUIViewController {
    val source by produceState<Pair<Sensors, List<Coordinate>>?>(null) {
        val replayFrom = (NSProcessInfo.processInfo.environment["TRACKS_REPLAY"] as? String)?.toIntOrNull()
        value = if (replayFrom != null) {
            bundledRide().let { ReplaySensors(it, fromSecond = replayFrom) to it.track }
        } else {
            LocationSensors() to emptyList()
        }
    }
    source?.let { (sensors, plan) -> MapHarness(sensors, plan) }
}
