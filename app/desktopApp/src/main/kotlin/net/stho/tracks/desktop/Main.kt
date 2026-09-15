package net.stho.tracks.desktop

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import java.io.File
import javax.imageio.ImageIO
import kotlin.system.exitProcess
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import net.stho.tracks.ui.harness.MapHarness
import net.stho.tracks.ui.harness.bundledRide
import net.stho.tracks.ui.map.DesktopMapHost
import net.stho.tracks.ui.map.configureDesktopMap
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.RideReplay

/** An iPhone's logical size, so what fits here fits there. */
val PHONE = DpSize(393.dp, 852.dp)

/**
 * The desktop harness.
 *
 *     --gpx <file>     the ride to replay (default: the bundled Garmisch ride)
 *     --from <s>       start that many seconds into it
 *     --speed <x>      replay x times faster than real time
 *     --tap-at <s>     click the map that many seconds after launch
 *     --shot <png>     capture the window to this file, then exit
 *     --shot-at <s>    how many seconds after launch to capture (default 20)
 *
 * The click and the capture go through the screen: see Screen.kt.
 */
fun main(args: Array<String>) {
    fun option(name: String) = args.indexOf(name).takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
    val gpx = option("--gpx")?.let { File(it).readText() }
    val from = option("--from")?.toInt() ?: 0
    val speedup = option("--speed")?.toDouble() ?: 1.0
    val tapAt = option("--tap-at")?.toDouble()
    val shot = option("--shot")?.let(::File)
    val shotAt = option("--shot-at")?.toDouble() ?: 20.0

    configureDesktopMap()
    application {
        Window(onCloseRequest = ::exitApplication, title = "Tracks — desktop harness", state = rememberWindowState(size = PHONE)) {
            if (tapAt != null) {
                LaunchedEffect(Unit) {
                    delay(tapAt.seconds)
                    // A third of the way down the map, clear of the controls at the bottom.
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
                replay?.let { ride ->
                    MapHarness(sensors = remember(ride) { ReplaySensors(ride, from, speedup) }, plan = ride.track)
                }
            }
        }
    }
}
