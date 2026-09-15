package net.stho.tracks.desktop

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import java.awt.Toolkit
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.imageio.ImageIO
import kotlin.system.exitProcess
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.withContext
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.routing.LegRouter
import net.stho.tracks.ui.net.JvmHttp
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.AppPlatform
import net.stho.tracks.ui.TracksApp
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.map.DesktopMapHost
import net.stho.tracks.ui.map.configureDesktopMap
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.RideReplay
import okio.FileSystem
import okio.Path.Companion.toPath

/** An iPhone's logical size, so what fits here fits there. */
val PHONE = DpSize(393.dp, 852.dp)

/**
 * The desktop harness: the app, with a replayed ride for a GPS and the real routing engine.
 *
 *     --gpx <file>        the ride to replay (default: the bundled Garmisch ride)
 *     --from <s>          start that many seconds into it
 *     --speed <x>         replay x times faster than real time
 *     --paste <link>      receive a plan link at launch, as a paste would; may be given more than once
 *     --data <dir>        where plans are kept (default: ~/.local/share/tracks-harness)
 *     --segments <dir>    the rd5 tiles to route over (default: the newest snapshot in ~/.cache/tracks/segments)
 *     --profiles <dir>    brouter.de's profiles (default: app/brouter/profiles)
 *     --tap-at <s>        click the map that many seconds after launch
 *     --shot <png>        capture the window to this file, then exit
 *     --shot-at <s>       how many seconds after launch to capture (default 20)
 *
 * The click and the capture go through the screen: see Screen.kt. **--tap-at and --shot are for the screenshots
 * container only** — on a desktop they capture and click the real screen, which is not to be done.
 *
 * Closing the window mid-ride is the app being killed: nothing is flushed on the way out, and the next launch offers
 * to continue.
 */
fun main(args: Array<String>) {
    fun option(name: String) = args.indexOf(name).takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
    val gpx = option("--gpx")?.let { File(it).readText() }
    val from = option("--from")?.toInt() ?: 0
    val speedup = option("--speed")?.toDouble() ?: 1.0
    val pastes = args.indices.filter { args[it] == "--paste" }.mapNotNull { args.getOrNull(it + 1) }
    val data = option("--data")?.let(::File) ?: File(System.getProperty("user.home"), ".local/share/tracks-harness")
    val segments = option("--segments") ?: newestSnapshot()
    val profiles = option("--profiles") ?: File("../brouter/profiles").absolutePath
    val tapAt = option("--tap-at")?.toDouble()
    val shot = option("--shot")?.let(::File)
    val shotAt = option("--shot-at")?.toDouble() ?: 20.0
    val rides = option("--rides")?.let(::File) ?: File(System.getProperty("user.home"), ".local/share/tracks-harness/rides")
    val server = option("--server")

    // One engine: the library's background routing and the editor's share it, one route at a time.
    val router = LegRouter(segments, profiles, Dispatchers.IO)
    val library = PlanLibrary(
        store = PlanStore(data.resolve("plans").absolutePath.toPath(), FileSystem.SYSTEM),
        router = router,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
        io = Dispatchers.IO,
        now = System::currentTimeMillis,
    )

    configureDesktopMap()
    application {
        Window(onCloseRequest = ::exitApplication, title = "Tracks — desktop harness", state = rememberWindowState(size = PHONE)) {
            if (tapAt != null) {
                LaunchedEffect(Unit) {
                    delay(tapAt.seconds)
                    // A third of the way down the map, clear of the sheet at the bottom.
                    withContext(Dispatchers.IO) { window.click(window.contentPane.width / 2, window.contentPane.height / 3) }
                    println("tapped")
                }
            }
            if (shot != null) {
                LaunchedEffect(Unit) {
                    delay(shotAt.seconds)
                    withContext(Dispatchers.IO) {
                        shot.absoluteFile.parentFile?.mkdirs()
                        ImageIO.write(window.capture(), "png", shot)
                    }
                    println("shot ${shot.path}")
                    exitProcess(0)
                }
            }
            DesktopMapHost(window) {
                val replay by produceState<RideReplay?>(null) { value = gpx?.let(RideReplay::gpx) ?: bundledRide() }
                val scope = rememberCoroutineScope()
                val store = remember { Rides(rides.toOkioPath()) }
                // The session beside the rides, in a file: the harness has no Keychain.
                val queue = remember {
                    server?.let { UploadQueue(store, TracksApi(tracksHttpClient(), it), FileSessionStore(rides.toOkioPath().parent!! / "session"), scope) }
                }
                replay?.let { ride ->
                    TracksApp(
                        library = library,
                        router = router,
                        geocoder = remember { PhotonGeocoder(JvmHttp) },
                        sensors = remember(ride) { ReplaySensors(ride, from, speedup) },
                        platform = DesktopPlatform,
                        links = remember { pastes.asFlow() },
                    )
                }
            }
        }
    }
}

/** The tiles the parity tests fetched: `~/.cache/tracks/segments/<snapshot>`, the newest there is. */
private fun newestSnapshot(): String {
    val cache = File(System.getenv("TRACKS_CACHE") ?: "${System.getProperty("user.home")}/.cache/tracks", "segments")
    return cache.listFiles { file -> file.isDirectory }?.maxByOrNull { it.name }?.absolutePath ?: cache.absolutePath
}

/** The desktop's clipboard stands in for both the phone's pasteboard and its share sheet. */
object DesktopPlatform : AppPlatform {
    override fun clipboardText(): String? =
        runCatching { Toolkit.getDefaultToolkit().systemClipboard.getData(DataFlavor.stringFlavor) as String }.getOrNull()

    override fun share(url: String) {
        runCatching { Toolkit.getDefaultToolkit().systemClipboard.setContents(StringSelection(url), null) }
        println("share $url")
    }
}
