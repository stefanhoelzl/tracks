package net.stho.tracks.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.distanceM
import kotlinx.coroutines.awaitCancellation
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.plan.moveWaypoint
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.plans.HomeScreen
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
private enum class Screen { Map, Home, Preview, Editor, EditorRouting, StopCarried }

private class Scene(
    val name: String,
    /** The second of the bundled ride the rider is held at. */
    val second: Int,
    val camera: (RideReplay) -> MapCamera,
    /** Where to click, from the map's centre, in pixels; a tap scene checks the coordinate instead of a picture. */
    val tap: Pair<Int, Int>? = null,
    val screen: Screen = Screen.Map,
)

/** The plans the app's screens are drawn with, recorded by `./gradlew :desktopApp:recordPlans`. */
private val PLANS = DIRECTORY.resolve("fixture/plans")

private val SCENES = listOf(
    Scene("home", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Home),
    Scene("preview", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Preview),
    Scene("editor", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.Editor),
    Scene("editor-routing", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.EditorRouting),
    Scene("stop-carried", second = 185, camera = { MapCamera.Follow(Orientation.NorthUp) }, screen = Screen.StopCarried),
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
            state = rememberWindowState(position = WindowPosition(0.dp, 0.dp), size = PHONE),
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
                    Screen.Home -> HomeScreen(
                        style = style,
                        fix = fix,
                        plans = plans,
                        routing = emptyMap(),
                        notice = null,
                        onPaste = {},
                        onOpen = {},
                        onEdit = {},
                        onCopy = {},
                        onShare = {},
                        onDelete = {},
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
                        onIdle = onIdle,
                    )
                    Screen.Editor, Screen.EditorRouting -> {
                        val scope = rememberCoroutineScope()
                        val editor = remember {
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
                            initiallyExpanded = true,
                            onIdle = onIdle,
                        )
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
