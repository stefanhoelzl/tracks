package net.stho.tracks.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import java.awt.image.BufferedImage
import java.io.File
import java.lang.management.ManagementFactory
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.imageio.ImageIO
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.system.exitProcess
import kotlin.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.Tally
import net.stho.tracks.riding.Detour
import net.stho.tracks.riding.Follower
import net.stho.tracks.riding.detour
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.ui.riding.DetourDialog
import net.stho.tracks.ui.riding.DetourTarget
import net.stho.tracks.ui.riding.UndoControls
import androidx.compose.ui.Alignment
import net.stho.tracks.riding.Progress
import net.stho.tracks.riding.Route
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.sensors.pressureAt
import net.stho.tracks.ui.riding.Navigation
import net.stho.tracks.ui.riding.RideStats
import net.stho.tracks.ui.offline.PlanOffline
import net.stho.tracks.plan.Range
import net.stho.tracks.ui.riding.Detent
import net.stho.tracks.ui.riding.RidePlanEditing
import net.stho.tracks.ui.riding.RidingScreen
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.recording.SaveRideSheet
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.distanceM
import kotlinx.coroutines.awaitCancellation
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.plan.moveWaypoint
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.plans.HomeScreen
import net.stho.tracks.ui.plans.PinTarget
import net.stho.tracks.ui.plans.PlanEditorScreen
import net.stho.tracks.ui.plans.PlanPreview
import net.stho.tracks.ui.plans.StopDrag
import net.stho.tracks.ui.plans.StopList
import net.stho.tracks.ui.theme.Tokens
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import okio.FileSystem
import okio.Path.Companion.toPath
import net.stho.tracks.ui.map.DesktopMapHost
import net.stho.tracks.ui.map.MapCredit
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.Orientation
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.ui.map.configureDesktopMap
import net.stho.tracks.ui.sensors.RideReplay

/*
 * The screenshot tests: the real map, drawn by MapLibre through Vulkan, compared with committed pictures of it.
 *
 * Logic tests cannot see a map that renders wrong — a layer missing, a line in the wrong colour, a camera facing the
 * wrong way — and that is what these are for. They run in the screenshots container (screenshots/run.sh), on Mesa's
 * software renderers with only the fonts it installs, so a picture made on one machine is the picture on another.
 *
 *     --scene <name>   one scene; without it, every scene, each in its own process (MapLibre's setup is per process)
 *     --update         write the references instead of comparing with them
 *     --record         fetch missing tile fixture files from VersaTiles instead of failing on them
 */

private val DIRECTORY = File("desktopApp/screenshots")
private val OUTPUT = File("desktopApp/build/screenshots")

private const val FOLLOW_ZOOM = 15.5

/**
 * How different a picture may be and still pass. Lavapipe's antialiasing and a Mesa patch release move edge pixels by a
 * little; a missing puck is ~0.06% of the picture, a missing plan line ~1%, a wrong camera most of it.
 */
private const val CHANNEL_TOLERANCE = 32
private const val PIXEL_TOLERANCE = 0.0003

/** How far from the expected coordinate a tap may land, in pixels. */
private const val TAP_TOLERANCE_PX = 2.0

/** What a scene draws: the map on its own, or one of the app's screens over it. */
private enum class Screen { Map, Home, HomeMenu, Preview, Editor, EditorRouting, EditorDialog, EditorNew, StopCarried, Riding, RidingOpen, RidingLarge, RidingRange, RidingPaused, RidingDialog, RidingDetour, FreeRide, SaveRide }

/** The iPhone SE2's 4.7″ screen, the phone every device check runs on: what riding has to fit. */
private val SE2 = DpSize(375.dp, 667.dp)

private class Scene(
    val name: String,
    /** The second of the bundled ride the rider is held at. */
    val second: Int,
    val camera: (RideReplay) -> MapCamera,
    /** Where to click, from the map's centre, in pixels; a tap scene checks the coordinate instead of a picture. */
    val tap: Pair<Int, Int>? = null,
    val screen: Screen = Screen.Map,
    val size: DpSize = PHONE,
)

/** The plans the app's screens are drawn with, recorded by `./gradlew :desktopApp:recordPlans`. */
private val PLANS = DIRECTORY.resolve("fixture/plans")

/** The plan the riding scenes follow — the bundled ride's own way out of Garmisch — recorded beside them. */
private val RIDING = DIRECTORY.resolve("fixture/riding")

private val SCENES = listOf(
    Scene("home", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Home),
    Scene("home-menu", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.HomeMenu),
    Scene("preview", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Preview),
    Scene("editor", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Editor),
    Scene("editor-routing", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.EditorRouting),
    Scene("editor-dialog", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.EditorDialog),
    Scene("editor-new", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.EditorNew),
    Scene("stop-carried", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.StopCarried),
    // 2.2 km in, 400 m before the ride's stop: the camera the riding screen sets, on the phone it has to fit.
    Scene("riding", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.Riding, size = SE2),
    Scene("riding-open", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingOpen, size = SE2),
    Scene("riding-large", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingLarge, size = SE2),
    // A stretch selected on the profile: two bars, its figures, and the same kilometres drawn on the map.
    Scene("riding-range", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingRange, size = SE2),
    Scene("riding-paused", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingPaused, size = SE2),
    Scene("save-ride", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.SaveRide, size = SE2),
    Scene("riding-dialog", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingDialog, size = SE2),
    Scene("riding-detour", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.RidingDetour, size = SE2),
    Scene("free-ride", second = 700, camera = { MapCamera.Follow(Orientation.HeadingUp) }, screen = Screen.FreeRide, size = SE2),
    Scene("follow", second = 185, camera = { MapCamera.Follow(Orientation.HeadingUp, FOLLOW_ZOOM) }),
    Scene("stop-compass", second = 950, camera = { MapCamera.Follow(Orientation.HeadingUp, FOLLOW_ZOOM) }),
    Scene("north-up", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp, FOLLOW_ZOOM) }),
    Scene("overview", second = 185, camera = { MapCamera.Overview(it.track) }),
    Scene("tap", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp, FOLLOW_ZOOM) }, tap = 100 to -150),
)

fun main(args: Array<String>) {
    val name = args.indexOf("--scene").takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
    val flags = args.filter { it == "--update" || it == "--record" }
    if (name == null) exitProcess(everyScene(flags))
    val scene = SCENES.firstOrNull { it.name == name } ?: error("no scene $name; there are ${SCENES.joinToString { it.name }}")
    render(scene, update = "--update" in flags, record = "--record" in flags)
}

private fun everyScene(flags: List<String>): Int {
    val command = listOf(ProcessHandle.current().info().command().get()) +
        ManagementFactory.getRuntimeMXBean().inputArguments +
        listOf("-cp", System.getProperty("java.class.path"), "net.stho.tracks.desktop.ScreenshotsKt")
    val failed = SCENES.filter { scene ->
        ProcessBuilder(command + listOf("--scene", scene.name) + flags).inheritIO().start().waitFor() != 0
    }
    println(if (failed.isEmpty()) "screenshots: ${SCENES.size} scenes pass" else "screenshots: FAILED ${failed.joinToString { it.name }}")
    return if (failed.isEmpty()) 0 else 1
}

private fun render(scene: Scene, update: Boolean, record: Boolean) {
    val server = FixtureServer(DIRECTORY.resolve("fixture"), record)
    // A cache of its own, so nothing a live run downloaded can stand in for a missing fixture.
    val cache = Files.createTempDirectory("tracks-screenshots").resolve("cache.db").toString()
    configureDesktopMap(cacheFile = cache, rewriteUrl = server::rewrite)

    // The map's credit, held still: open on home, the first map of a launch, and the ⓘ it collapses to everywhere else.
    if (scene.screen == Screen.Home) MapCredit.openFor = Duration.INFINITE else MapCredit.shown = true

    val ride = runBlocking { bundledRide() }
    val fix = ride.fixes[scene.second].copy(epochMillis = System.currentTimeMillis())
    val heading = ride.headings[scene.second]?.let { Heading(it, fix.epochMillis) }
    val firstIdle = AtomicLong(0)
    val lastIdle = AtomicLong(0)
    val tapped = AtomicReference<Coordinate?>(null)

    // A missing fixture file fails nothing by itself: the map asks for tiles on its way to a picture that it does not
    // end up drawing, and which ones depends on timing. One that matters changes the picture, and then it is named.
    fun finish(failure: String?): Nothing {
        val misses = server.misses.distinct()
        val missing = misses.takeIf { it.isNotEmpty() }
            ?.let { "${it.size} fixture files were missing, e.g. ${it.take(3)} — screenshots/run.sh --record fetches them" }
        val outcome = when {
            failure != null -> "FAILED $failure" + (missing?.let { ". $it" } ?: "")
            update -> "updated"
            else -> "pass" + (missing?.let { " ($it)" } ?: "")
        }
        println("screenshot ${scene.name}: $outcome")
        server.close()
        exitProcess(if (failure == null) 0 else 1)
    }

    application {
        // Pinned to the screen's corner. With no window manager under Xvfb, a window left to place itself can still be
        // moving when the picture is taken, and the capture comes out shifted by the difference.
        Window(
            onCloseRequest = ::exitApplication,
            title = "Tracks — ${scene.name}",
            state = rememberWindowState(position = WindowPosition(0.dp, 0.dp), size = scene.size),
            resizable = false,
            undecorated = true,
        ) {
            LaunchedEffect(Unit) {
                withContext(Dispatchers.IO) {
                    // Drawn, and then quiet for two seconds: the camera has arrived and every tile is in.
                    val deadline = System.currentTimeMillis() + 120_000
                    while (true) {
                        val now = System.currentTimeMillis()
                        if (firstIdle.get() > 0 && now - firstIdle.get() > 3_000 && now - lastIdle.get() > 2_000) break
                        if (now > deadline) {
                            finish(
                                "the map never settled. A blank map here usually means Skiko fell back to software " +
                                    "drawing, which the map refuses: check force_gl_renderer in screenshots/scene.sh",
                            )
                        }
                        delay(200)
                    }
                    val width = window.contentPane.width
                    val height = window.contentPane.height
                    scene.tap?.let { (dx, dy) ->
                        window.click(width / 2 + dx, height / 2 + dy)
                        repeat(50) { if (tapped.get() == null) delay(100) }
                        finish(checkTap(tapped.get(), fix.at, dx, dy))
                    }
                    finish(checkPicture(scene.name, window.capture(), update))
                }
            }
            DesktopMapHost(window) {
                val style by produceState<MapStyle?>(null) { value = MapStyle.colorful() }
                val onIdle = {
                    val now = System.currentTimeMillis()
                    firstIdle.compareAndSet(0, now)
                    lastIdle.set(now)
                }
                // Only read: nothing in a scene routes or saves.
                val plans = remember { PlanStore(PLANS.absolutePath.toPath(), FileSystem.SYSTEM).list() }
                when (scene.screen) {
                    Screen.Map -> style?.let {
                        TracksMap(
                            style = it,
                            camera = remember { scene.camera(ride) },
                            modifier = Modifier.fillMaxSize(),
                            plan = ride.track,
                            fix = fix,
                            heading = heading,
                            onTap = { at -> tapped.set(at) },
                            onIdle = onIdle,
                        )
                    }
                    Screen.Home, Screen.HomeMenu -> HomeScreen(
                        style = style,
                        fix = fix,
                        plans = plans,
                        routing = emptyMap(),
                        notice = null,
                        onNew = {},
                        onRide = {},
                        onOpen = {},
                        onNavigate = {},
                        onEdit = {},
                        onCopy = {},
                        onShare = {},
                        onDelete = {},
                        menuOpen = plans.first().id.takeIf { scene.screen == Screen.HomeMenu },
                        // Every mark a plan can have offline, one a row.
                        offline = { id ->
                            when (plans.indexOfFirst { it.id == id }) {
                                0 -> PlanOffline.PhoneFull
                                1 -> PlanOffline.Pending
                                2 -> PlanOffline.Downloading(0.4)
                                else -> PlanOffline.Ready
                            }
                        },
                        onIdle = onIdle,
                    )
                    Screen.Preview -> PlanPreview(
                        style = style,
                        stored = plans.first { it.plan.name == "Partnachklamm" },
                        routing = null,
                        fix = fix,
                        onBack = {},
                        onEdit = {},
                        onCopy = {},
                        onShare = {},
                        onDelete = {},
                        onIdle = onIdle,
                    )
                    Screen.Editor, Screen.EditorRouting, Screen.EditorDialog, Screen.EditorNew -> {
                        val scope = rememberCoroutineScope()
                        val editor = remember {
                            if (scene.screen == Screen.EditorNew) return@remember PlanEditor.blank({ _, _ -> awaitCancellation() }, scope, id = "new")
                            // An engine that never answers: whatever an edit touches stays routing, drawn still.
                            val stored = plans.first { it.plan.name == "Partnachklamm" }
                            PlanEditor(stored, { _, _ -> awaitCancellation() }, scope).also { editor ->
                                if (scene.screen == Screen.EditorRouting) {
                                    val plan = editor.state.value.plan
                                    val stadium = plan.waypoints[2]
                                    editor.update(moveWaypoint(plan, 2, Coordinate(stadium.lat + 0.003, stadium.lon - 0.004)))
                                }
                            }
                        }
                        PlanEditorScreen(
                            style = style,
                            editor = editor,
                            geocoder = remember { PhotonGeocoder({ error("no network in a scene") }) },
                            fix = fix,
                            onCancel = {},
                            onSave = {},
                            onCopy = {},
                            pulse = false,
                            // The dialog sits over the map, and a new plan opens on the rider: both keep the sheet minimised.
                            initiallyExpanded = scene.screen != Screen.EditorDialog && scene.screen != Screen.EditorNew,
                            initialDialog = remember {
                                if (scene.screen != Screen.EditorDialog) return@remember null
                                // A place halfway along the first leg: every choice a new place near a leg offers.
                                val (a, b) = editor.state.value.plan.waypoints
                                PinTarget.New(Coordinate((a.lat + b.lat) / 2, (a.lon + b.lon) / 2), leg = 0, name = "Kochelberg")
                            },
                            onIdle = onIdle,
                        )
                    }
                    Screen.Riding, Screen.RidingOpen, Screen.RidingLarge, Screen.RidingRange, Screen.RidingPaused, Screen.RidingDialog, Screen.RidingDetour, Screen.FreeRide, Screen.SaveRide -> {
                        // The ride up to this second, recorded and followed as the phone would have, fix by fix.
                        val ridden = remember { ride.fixes.take(scene.second + 1) }
                        val tally = remember {
                            Tally().apply {
                                ridden.forEach { f ->
                                    f.altitudeM?.let { add(Entry.Pressured(Pressure(pressureAt(it), f.epochMillis))) }
                                    add(Entry.Located(f))
                                }
                            }
                        }
                        // Somewhere 300 m off the road ahead: where the dialog was raised, and the detour goes through.
                        val detourAt = remember { ride.fixes[scene.second + 150].at.let { Coordinate(it.lat + 0.0027, it.lon) } }
                        val navigation = remember {
                            if (scene.screen == Screen.FreeRide) return@remember null
                            val recorded = PlanStore(RIDING.absolutePath.toPath(), FileSystem.SYSTEM).list().single()
                            // Made on the leg the rider is on, and not routed yet: the leg a straight dash, still.
                            val stored = if (scene.screen != Screen.RidingDetour) {
                                recorded
                            } else {
                                val plan = detour(recorded.plan, recorded.legs, 0, detourAt, Detour.Through, null)
                                recorded.copy(plan = plan, legs = listOf(null, recorded.legs[1]))
                            }
                            val route = Route(stored.plan.waypoints, stored.legs)
                            val follower = Follower(route)
                            var progress: Progress? = null
                            ridden.forEach { progress = follower.follow(it.at) }
                            Navigation(stored, route, progress)
                        }
                        RidingScreen(
                            style = style,
                            fix = fix,
                            heading = heading,
                            ridden = ridden.map { it.at },
                            navigation = navigation,
                            routing = PlanRouting(routing = 0).takeIf { scene.screen == Screen.RidingDetour },
                            elevation = remember { tally.elevation.terrain() },
                            // Stopped, the Save sheet asks and there is no ride sheet under it; paused, the sheet is
                            // open to the detent that carries Resume and Stop.
                            stats = RideStats(
                                paused = scene.screen == Screen.RidingPaused,
                                distanceM = tally.odometer.distanceM,
                                climbedM = tally.climb.gainM,
                                movingMillis = tally.odometer.movingMillis,
                            ).takeIf { scene.screen != Screen.SaveRide },
                            onPause = {},
                            onResume = {},
                            onStop = {},
                            detent = when (scene.screen) {
                                Screen.RidingOpen, Screen.RidingRange -> Detent.Medium
                                // Paused is drawn at the large detent, which is where Pause and Stop now live.
                                Screen.RidingLarge, Screen.RidingPaused -> Detent.Large
                                else -> Detent.Small
                            },
                            // The stop list the large detent shows, with no search: the harness has no geocoder.
                            editing = navigation?.plan?.let { RidePlanEditing(it.plan, it.legs, onRemove = {}, onMoveStop = { _, _ -> }) },
                            undo = UndoControls(canUndo = true, canRedo = false, onUndo = {}, onRedo = {}).takeIf { scene.screen == Screen.RidingDetour },
                            pulse = false,
                            // Open, a place picked a little way up the profile: the map shows it.
                            initiallyPickedM = navigation?.progress?.takeIf { scene.screen == Screen.RidingOpen }?.let { it.alongM + 250.0 },
                            // A stretch of the leg you are on, in metres along that page. The page starts at the stop
                            // *behind* the rider, who is near its end, so a stretch worth a picture is one near the
                            // end too: those are the kilometres the camera is framing, and the shot then shows both
                            // halves of a selection rather than the chart's half alone.
                            initialRange = Range(1850.0, 2350.0).takeIf { scene.screen == Screen.RidingRange },
                            onIdle = onIdle,
                        ) {
                            if (scene.screen == Screen.SaveRide) {
                                Box(Modifier.align(Alignment.BottomCenter).padding(12.dp)) {
                                    SaveRideSheet(
                                        RecorderState.Stopped(id = "scene", title = navigation?.plan?.plan?.name ?: "", sport = "bike"),
                                        onSave = { _, _ -> },
                                        onContinue = {},
                                        onDiscard = {},
                                    )
                                }
                            }
                            if (scene.screen == Screen.RidingDialog) {
                                DetourDialog(
                                    DetourTarget(detourAt, "Kochelberg"),
                                    onDetour = {},
                                    onClose = {},
                                    modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp),
                                )
                            }
                        }
                    }
                    Screen.StopCarried -> {
                        // No map here, so nothing idles on its own: the list is drawn at once.
                        LaunchedEffect(Unit) { onIdle() }
                        val stored = plans.first { it.plan.name == "Partnachklamm" }
                        Box(Modifier.fillMaxSize().background(Tokens.glassHi).padding(16.dp)) {
                            StopList(
                                plan = stored.plan,
                                legs = stored.legs,
                                base = 0,
                                onBase = {},
                                onEdit = {},
                                onRemove = {},
                                onMoveStop = { _, _ -> },
                                carried = StopDrag(stop = 1, offsetPx = 60f),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun checkPicture(name: String, actual: BufferedImage, update: Boolean): String? {
    val reference = DIRECTORY.resolve("$name.png")
    if (update) {
        ImageIO.write(actual, "png", reference)
        return null
    }
    OUTPUT.mkdirs()
    ImageIO.write(actual, "png", OUTPUT.resolve("$name.png"))
    if (!reference.isFile) return "no reference ${reference.path} — run screenshots/run.sh --update"
    val expected = ImageIO.read(reference)
    if (expected.width != actual.width || expected.height != actual.height) {
        return "${actual.width}×${actual.height}, the reference is ${expected.width}×${expected.height}"
    }
    val diff = BufferedImage(actual.width, actual.height, BufferedImage.TYPE_INT_RGB)
    var differing = 0
    for (y in 0 until actual.height) for (x in 0 until actual.width) {
        val a = actual.getRGB(x, y)
        val e = expected.getRGB(x, y)
        val delta = max(max(abs((a shr 16 and 0xFF) - (e shr 16 and 0xFF)), abs((a shr 8 and 0xFF) - (e shr 8 and 0xFF))), abs((a and 0xFF) - (e and 0xFF)))
        if (delta > CHANNEL_TOLERANCE) {
            differing++
            diff.setRGB(x, y, 0xFF0000)
        } else {
            val grey = 128 + ((e shr 8 and 0xFF) shr 1)
            diff.setRGB(x, y, grey shl 16 or (grey shl 8) or grey)
        }
    }
    val share = differing.toDouble() / (actual.width * actual.height)
    if (share <= PIXEL_TOLERANCE) return null
    ImageIO.write(diff, "png", OUTPUT.resolve("$name-diff.png"))
    return "%.3f%% of pixels differ (at most %.3f%%): see %s".format(share * 100, PIXEL_TOLERANCE * 100, OUTPUT.resolve("$name-diff.png"))
}

/** The coordinate a pixel offset from [centre] lands on, north-up at [zoom], in MapLibre's 512 px Web Mercator world. */
private fun unproject(centre: Coordinate, zoom: Double, dx: Double, dy: Double): Coordinate {
    val world = 512.0 * 2.0.pow(zoom)
    val sinLat = sin(centre.lat * PI / 180)
    val x = (centre.lon + 180) / 360 * world + dx
    val y = (0.5 - ln((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * world + dy
    return Coordinate(lat = atan(sinh(PI - 2 * PI * y / world)) * 180 / PI, lon = x / world * 360 - 180)
}

private fun checkTap(tapped: Coordinate?, centre: Coordinate, dx: Int, dy: Int): String? {
    tapped ?: return "the tap was never reported"
    val expected = unproject(centre, FOLLOW_ZOOM, dx.toDouble(), dy.toDouble())
    val metresPerPixel = cos(centre.lat * PI / 180) * 2 * PI * 6_378_137.0 / (512.0 * 2.0.pow(FOLLOW_ZOOM))
    val offPx = distanceM(tapped, expected) / metresPerPixel
    println("tap: expected $expected, reported $tapped, ${"%.2f".format(offPx)} px apart")
    return if (offPx <= TAP_TOLERANCE_PX) null else "the tap landed %.1f px from where it was clicked".format(offPx)
}
