package net.stho.tracks.ui

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.window.ComposeUIViewController
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.recording.Rides
import net.stho.tracks.ui.harness.MapHarness
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.sensors.LocationSensors
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.Sensors
import net.stho.tracks.ui.sensors.shared
import net.stho.tracks.ui.upload.KeychainSessionStore
import net.stho.tracks.ui.upload.UploadQueue
import net.stho.tracks.ui.upload.tracksHttpClient
import net.stho.tracks.upload.TracksApi
import platform.Foundation.NSProcessInfo
import platform.UIKit.UIViewController

/**
 * The app's screen, for the Swift shell to put in its window: the map, recording, and the upload queue.
 *
 * It follows the phone's own location, compass and barometer, and uploads to tracks.stho.net. Two launch variables
 * (`pymobiledevice3 developer dvt launch --env`) change that for testing:
 *
 * - `TRACKS_REPLAY=<second>` replays the bundled ride from that second — the same ride the desktop harness and the
 *   screenshot tests draw, which is how the three are compared.
 * - `TRACKS_SERVER=<url>` uploads somewhere else: a dev server on this network, `http://<address>:<port>`, which is how a
 *   ride is uploaded from the phone without reaching production.
 */
fun MainViewController(): UIViewController = ComposeUIViewController {
    val environment = NSProcessInfo.processInfo.environment
    val replayFrom = (environment["TRACKS_REPLAY"] as? String)?.toIntOrNull()
    val server = (environment["TRACKS_SERVER"] as? String) ?: PRODUCTION_SERVER

    // The UI's own scope, on the main thread: what the recorder and the queue need theirs to be.
    val scope = rememberCoroutineScope()
    val location = remember { LocationSensors().takeIf { replayFrom == null } }
    val source by produceState<Pair<Sensors, List<Coordinate>>?>(null) {
        value = if (replayFrom != null) {
            bundledRide().let { ReplaySensors(it, fromSecond = replayFrom).shared(scope) to it.track }
        } else {
            location!!.shared(scope) to emptyList()
        }
    }
    val rides = remember { Rides(ridesDirectory()) }
    val queue = remember { UploadQueue(rides, TracksApi(tracksHttpClient(), server), KeychainSessionStore(), scope) }

    source?.let { (sensors, plan) ->
        val recorder = remember(sensors) { Recorder(rides, sensors, scope, dateTitle = ::localDate, onSaved = queue::kick) }
        val recording by recorder.state.collectAsState()

        // Location keeps running with the phone locked only while there is a ride to record, paused or not.
        LaunchedEffect(recording is RecorderState.Recording) {
            location?.recording = recording is RecorderState.Recording
        }

        DisposableEffect(recorder) {
            // Leaving the screen is when iOS may end the app without asking: what is buffered goes to disk first.
            val stopLifecycle = onAppLifecycle(background = recorder::flush, foreground = queue::kick)
            val stopNetwork = whenOnline(queue::kick)
            onDispose {
                stopLifecycle()
                stopNetwork()
            }
        }

        MapHarness(sensors, plan, recorder = recorder, upload = queue)
    }
}
