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
import net.stho.tracks.routing.BRouterDe
import net.stho.tracks.routing.LegRouter
import net.stho.tracks.routing.OnlineFirstRouter
import net.stho.tracks.ui.net.JvmHttp
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.AppPlatform
import net.stho.tracks.ui.TracksApp
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.map.DesktopMapHost
import net.stho.tracks.ui.measure.Ablation
import net.stho.tracks.ui.measure.MeasuredRide
import net.stho.tracks.ui.measure.RideMeasure
import net.stho.tracks.ui.measure.applyMeasureOverrides
import net.stho.tracks.ui.measure.seedJournal
import net.stho.tracks.ui.map.configureDesktopMap
import net.stho.tracks.ui.offline.offlineData
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.recording.Rides
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.RideReplay
import net.stho.tracks.ui.sensors.shared
import net.stho.tracks.ui.upload.UploadQueue
import net.stho.tracks.ui.upload.tracksHttpClient
import net.stho.tracks.upload.FileSessionStore
import net.stho.tracks.upload.TracksApi
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.Path.Companion.toPath

/** An iPhone's logical size, so what fits here fits there. */
val PHONE = DpSize(393.dp, 852.dp)

/**
 * The desktop harness: the app, with a replayed ride for a GPS and the real routing engine.
 *
 *     --gpx <file>        the ride to replay (default: the bundled Garmisch ride)
 *     --from <s>          start that many seconds into it
 *     --speed <x>         replay x times faster than real time
 *     --link <link>       receive a plan link at launch, as opening it on the phone would; may be given more than once
 *     --data <dir>        where plans are kept (default: ~/.local/share/tracks-harness)
 *     --segments <dir>    the rd5 tiles to route over (default: the newest snapshot in ~/.cache/tracks/segments)
 *     --route-on-device   route on the engine only, as the phone does with no network (default: brouter.de, and the
 *                         engine when brouter.de cannot be reached)
 *     --profiles <dir>    brouter.de's profiles (default: app/brouter/profiles)
 *     --tap-at <s>        click the map that many seconds after launch
 *     --shot <png>        capture the window to this file, then exit
 *     --shot-at <s>       how many seconds after launch to capture (default 20)
 *     --rides <dir>       where recorded rides are journaled (default ~/.local/share/tracks-harness/rides)
 *     --server <url>      the Tracks that saved rides upload to: http://[::1]:5173 for `pnpm dev:local`, which listens
 *                         on IPv6 loopback only. No default, so it is never tracks.stho.net by accident: without it,
 *                         nothing uploads.
 *     --seed <n>          start from a journal n fixes deep, as if the ride had already been running that long:
 *                         what the ridden line costs at hour six, without riding six hours to find out
 *     --measure <file>    measure the ride: start it at launch and sample CPU, frames and depth into <file> as JSONL,
 *                         in the same shape the phone writes (app/docs/PROFILING.md)
 *     --label <name>      what to call this run in that file (default: the ablation, or `baseline`)
 *     --ablate <name>     switch one path off so the difference prices it: NoMap, NoHeading, Idle, StaticCamera;
 *                         the phone's value overrides (TRACKS_FOLLOW_MS, TRACKS_MAX_FPS, …) come from the environment
 *     --offline <dir>     keep offline data around the replay, as the phone does around you: map packs from
 *                         tiles.versatiles.org and segment tiles from brouter.de, about 1 GB, into <dir>; routing then
 *                         reads <dir>/segments unless --segments says otherwise. Off by default, so the harness
 *                         downloads nothing it was not asked to — and a second run finds it all there.
 *
 * The click and the capture go through the screen: see Screen.kt. **--tap-at and --shot are for the screenshots
 * container only** — on a desktop they capture and click the real screen, which is not to be done.
 *
 * Closing the window mid-ride is the app being killed: nothing is flushed on the way out, and the next launch offers
 * to continue.
 */
fun main(args: Array<String>) {
    matchDesktopScale()
    fun option(name: String) = args.indexOf(name).takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
    val gpx = option("--gpx")?.let { File(it).readText() }
    val from = option("--from")?.toInt() ?: 0
    val speedup = option("--speed")?.toDouble() ?: 1.0
    val links = args.indices.filter { args[it] == "--link" }.mapNotNull { args.getOrNull(it + 1) }
    val data = option("--data")?.let(::File) ?: File(System.getProperty("user.home"), ".local/share/tracks-harness")
    val offlineDirectory = option("--offline")?.let(::File)?.also { it.mkdirs() }
    val segments = option("--segments") ?: offlineDirectory?.resolve("segments")?.absolutePath ?: newestSnapshot()
    val offlineRouting = "--route-on-device" in args
    val profiles = option("--profiles") ?: File("../brouter/profiles").absolutePath
    val tapAt = option("--tap-at")?.toDouble()
    val shot = option("--shot")?.let(::File)
    val shotAt = option("--shot-at")?.toDouble() ?: 20.0
    val rides = option("--rides")?.let(::File) ?: File(System.getProperty("user.home"), ".local/share/tracks-harness/rides")
    val server = option("--server")
    val ablation = Ablation.of(option("--ablate")).also { Ablation.current = it }
    val label = option("--label") ?: ablation?.name ?: "baseline"
    val measure = option("--measure")?.let { RideMeasure(it.toPath(), label) }
    // The phone's TRACKS_FOLLOW_MS, TRACKS_MAX_FPS, … from the environment, so one name means one thing everywhere.
    if (measure != null) applyMeasureOverrides(System::getenv)
    val seed = option("--seed")?.toInt()

    // brouter.de, as the phone routes with a network; the engine when brouter.de cannot be reached. One engine: the
    // library's background routing and the editor's share it, one route at a time.
    val router = OnlineFirstRouter(
        online = BRouterDe(JvmHttp),
        onDevice = LegRouter(segments, profiles, Dispatchers.IO),
        isOnline = { !offlineRouting },
    )
    val library = PlanLibrary(
        store = PlanStore(data.resolve("plans").absolutePath.toPath(), FileSystem.SYSTEM),
        router = router,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
        io = Dispatchers.IO,
        now = System::currentTimeMillis,
    )

    configureDesktopMap(cacheFile = offlineDirectory?.resolve("maplibre.db")?.path)
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
                    // One replay for the map and the recorder: collected twice, it would be two rides.
                    val sensors = remember(ride) { ReplaySensors(ride, from, speedup).shared(scope) }
                    // Before the Recorder, which decides what to offer by reading the journals once.
                    remember(ride) { seed?.let { seedJournal(store, ride, it, System.currentTimeMillis(), id = "seed-$label") } }
                    val recorder = remember(sensors) { Recorder(store, sensors, scope, dateTitle = ::localDate, onSaved = { queue?.kick() }) }
                    val offline = remember(sensors) {
                        offlineDirectory?.let { dir ->
                            offlineData(
                                sensors, library.plans, dir.toOkioPath(), segments.toPath(), scope,
                                freeBytes = { dir.usableSpace }, onTilesLanded = library::routeWhatIsMissing,
                            )
                        }
                    }
                    // Frames counted: the desktop's map draws on the frame clock, so fps is the harness's main reading.
                    measure?.let { MeasuredRide(recorder, it, countFrames = true) }
                    TracksApp(
                        library = library,
                        router = router,
                        geocoder = remember { PhotonGeocoder(JvmHttp) },
                        sensors = sensors,
                        platform = DesktopPlatform,
                        recorder = recorder,
                        upload = queue,
                        offline = offline,
                        links = remember { links.asFlow() },
                    )
                }
            }
        }
    }
}

/**
 * Draws at the scale the desktop asks X11 apps for. A GNOME Wayland session with fractional scaling gives Xwayland apps
 * the screen's real pixels and says how to scale in `Xft.dpi` (192 is 2×), which Java does not read: left alone, the
 * harness is drawn at 1× and its text is tiny. Java takes only a whole scale on Linux, so it is rounded.
 *
 * Must run before anything touches AWT. `-Dsun.java2d.uiScale` or `GDK_SCALE` still override it; without `xrdb`, or
 * under the screenshots container's Xvfb, which sets no `Xft.dpi`, nothing changes.
 */
private fun matchDesktopScale() {
    if (System.getProperty("sun.java2d.uiScale") != null || System.getenv("GDK_SCALE") != null) return
    val dpi = runCatching {
        ProcessBuilder("xrdb", "-query").redirectErrorStream(true).start().inputReader().readLines()
            .firstNotNullOfOrNull { Regex("""^Xft\.dpi:\s*(\d+(\.\d+)?)""").find(it)?.groupValues?.get(1)?.toDouble() }
    }.getOrNull() ?: return
    val scale = Math.round(dpi / 96).coerceAtLeast(1)
    if (scale > 1) System.setProperty("sun.java2d.uiScale", scale.toString())
}

/** A ride with no plan is titled with its date, as this machine writes one. */
private fun localDate(epochMillis: Long): String =
    Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))

/** The tiles the parity tests fetched: `~/.cache/tracks/segments/<snapshot>`, the newest there is. */
private fun newestSnapshot(): String {
    val cache = File(System.getenv("TRACKS_CACHE") ?: "${System.getProperty("user.home")}/.cache/tracks", "segments")
    return cache.listFiles { file -> file.isDirectory }?.maxByOrNull { it.name }?.absolutePath ?: cache.absolutePath
}

/** The desktop's clipboard stands in for the phone's share sheet. */
object DesktopPlatform : AppPlatform {
    override fun share(url: String) {
        runCatching { Toolkit.getDefaultToolkit().systemClipboard.setContents(StringSelection(url), null) }
        println("share $url")
    }
}
