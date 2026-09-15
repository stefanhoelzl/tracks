package net.stho.tracks.ui

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.window.ComposeUIViewController
import kotlin.time.Clock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.MainScope
import net.stho.tracks.routing.LegRouter
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.sensors.LocationSensors
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.Sensors
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
 * The app's screen, for the Swift shell to put in its window: the map, recording, and the upload queue.
 *
 * It follows the phone's own location and compass. Launched with TRACKS_REPLAY=<second> (`pymobiledevice3 developer
 * dvt launch --env`), it replays the bundled ride from that second instead — the same ride the desktop harness and the
 * screenshot tests draw, which is how the three are compared.
 *
 * Plans live in Application Support, which an app update keeps and iOS never purges. Routing tiles are read from
 * Documents/segments, where they are pushed by hand until M13 downloads them.
 */
fun MainViewController(): UIViewController = ComposeUIViewController {
    val library = remember {
        PlanLibrary(
            store = PlanStore(directory("plans", NSApplicationSupportDirectory).toPath(), FileSystem.SYSTEM),
            router = LegRouter(
                segmentDir = directory("segments", NSDocumentDirectory),
                profileDir = NSBundle.mainBundle.resourcePath + "/profiles",
                dispatcher = Dispatchers.IO,
            ),
            scope = MainScope(),
            io = Dispatchers.IO,
            now = { Clock.System.now().toEpochMilliseconds() },
        )
    }
    val sensors by produceState<Sensors?>(null) {
        val replayFrom = (NSProcessInfo.processInfo.environment["TRACKS_REPLAY"] as? String)?.toIntOrNull()
        value = if (replayFrom != null) ReplaySensors(bundledRide(), fromSecond = replayFrom) else LocationSensors()
    }
    sensors?.let { TracksApp(library, it, IosPlatform) }
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
