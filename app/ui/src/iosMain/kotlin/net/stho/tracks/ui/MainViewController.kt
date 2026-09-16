package net.stho.tracks.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.window.ComposeUIViewController
import kotlin.time.Clock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.MainScope
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.recording.Rides
import net.stho.tracks.routing.LegRouter
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.map.configureMaps
import net.stho.tracks.ui.net.IosHttp
import net.stho.tracks.ui.offline.backgroundSegments
import net.stho.tracks.ui.offline.freeBytes
import net.stho.tracks.ui.offline.mapsCacheFile
import net.stho.tracks.ui.offline.networkState
import net.stho.tracks.ui.offline.downloadHttpClient
import net.stho.tracks.ui.offline.profilesDirectory
import net.stho.tracks.offline.ProfileSync
import net.stho.tracks.routing.BRouterDe
import net.stho.tracks.routing.OnlineFirstRouter
import net.stho.tracks.ui.offline.offlineData
import net.stho.tracks.ui.offline.offlineDirectory
import net.stho.tracks.ui.offline.segmentsDirectory
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
import okio.FileSystem
import okio.Path.Companion.toPath
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSBundle
import platform.Foundation.NSDocumentDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSProcessInfo
import platform.Foundation.NSURL
import platform.Foundation.NSUserDomainMask
import platform.UIKit.UIActivityViewController
import platform.UIKit.UIApplication
import platform.UIKit.UIPasteboard
import platform.UIKit.UIViewController

/**
 * The app's screen, for the Swift shell to put in its window: the plans, their editor, and recording with its upload
 * queue.
 *
 * It follows the phone's own location, compass and barometer, and uploads to tracks.stho.net. Two launch variables
 * (`pymobiledevice3 developer dvt launch --env`) change that for testing:
 *
 * - `TRACKS_REPLAY=<second>` replays the bundled ride from that second — the same ride the desktop harness and the
 *   screenshot tests draw, which is how the three are compared.
 * - `TRACKS_SERVER=<url>` uploads somewhere else: a dev server on this network, `http://<address>:<port>`, which is how a
 *   ride is uploaded from the phone without reaching production.
 *
 * Plans live in Application Support, which an app update keeps and iOS never purges. Routing tiles are read from
 * Documents/segments, where offline data downloads them; the map's offline packs are in Application Support too.
 */
fun MainViewController(): UIViewController {
    // MapLibre's setup belongs to the process, and comes before the first map.
    configureMaps(cacheFile = mapsCacheFile())
    // Before anything else asks: iOS may have relaunched the app to hand over tiles it finished downloading.
    backgroundSegments()
    return ComposeUIViewController { TracksScreen() }
}

@Composable
private fun TracksScreen() {
    val environment = NSProcessInfo.processInfo.environment
    val replayFrom = (environment["TRACKS_REPLAY"] as? String)?.toIntOrNull()
    val server = (environment["TRACKS_SERVER"] as? String) ?: PRODUCTION_SERVER

    // brouter.de while there is a network, as the web routes; the engine on the phone without one. One engine: the
    // library's background routing and the editor's share it, one route at a time.
    // The engine's profiles, in the app's own directory: the bundled ones until brouter.de's change (offline data).
    val profiles = remember {
        ProfileSync(profilesDirectory(), downloadHttpClient(), clock = { Clock.System.now().toEpochMilliseconds() })
            .also { it.seed((NSBundle.mainBundle.resourcePath + "/profiles").toPath()) }
    }
    val router = remember {
        val network = networkState(MainScope())
        OnlineFirstRouter(
            online = BRouterDe(IosHttp),
            onDevice = LegRouter(
                segmentDir = segmentsDirectory().toString(),
                profileDir = profiles.directory.toString(),
                dispatcher = Dispatchers.IO,
            ),
            isOnline = { network.value != null },
        )
    }
    val geocoder = remember { PhotonGeocoder(IosHttp) }
    val library = remember {
        PlanLibrary(
            store = PlanStore(directory("plans", NSApplicationSupportDirectory).toPath(), FileSystem.SYSTEM),
            router = router,
            scope = MainScope(),
            io = Dispatchers.IO,
            now = { Clock.System.now().toEpochMilliseconds() },
        )
    }

    // The UI's own scope, on the main thread: what the recorder and the queue need theirs to be.
    val scope = rememberCoroutineScope()
    val location = remember { LocationSensors().takeIf { replayFrom == null } }
    val sensors by produceState<Sensors?>(null) {
        // One stream for the map and the recorder: collected twice, it would be two rides.
        value = if (replayFrom != null) ReplaySensors(bundledRide(), fromSecond = replayFrom).shared(scope) else location!!.shared(scope)
    }
    val rides = remember { Rides(ridesDirectory()) }
    val queue = remember { UploadQueue(rides, TracksApi(tracksHttpClient(), server), KeychainSessionStore(), scope) }

    sensors?.let { shared ->
        val recorder = remember(shared) { Recorder(rides, shared, scope, dateTitle = ::localDate, onSaved = queue::kick) }
        val recording by recorder.state.collectAsState()
        val offline = remember(shared) {
            offlineData(
                shared, library.plans, offlineDirectory(), segmentsDirectory(), scope, ::freeBytes,
                onTilesLanded = library::routeWhatIsMissing,
                transfer = { backgroundSegments() },
                profiles = profiles,
            )
        }

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

        TracksApp(
            library = library,
            router = router,
            geocoder = geocoder,
            sensors = shared,
            platform = IosPlatform,
            recorder = recorder,
            upload = queue,
            offline = offline,
            links = IncomingLinks.links,
        )
    }
}

private fun directory(name: String, base: ULong): String {
    val root = NSFileManager.defaultManager.URLsForDirectory(base, NSUserDomainMask).first() as NSURL
    return root.path + "/" + name
}

private object IosPlatform : AppPlatform {
    override fun clipboardText(): String? = UIPasteboard.generalPasteboard.string

    override fun share(url: String) {
        val link = NSURL.URLWithString(url) ?: return
        val sheet = UIActivityViewController(activityItems = listOf(link), applicationActivities = null)
        UIApplication.sharedApplication.keyWindow?.rootViewController?.presentViewController(sheet, animated = true, completion = null)
    }
}
