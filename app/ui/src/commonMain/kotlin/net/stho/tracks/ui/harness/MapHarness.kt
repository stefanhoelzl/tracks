package net.stho.tracks.ui.harness

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.flowOf
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.map.AreaState
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.Orientation
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.offline.SegmentProblem
import net.stho.tracks.ui.offline.OfflineData
import net.stho.tracks.ui.offline.OfflineState
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecordingControls
import net.stho.tracks.ui.resources.Res
import net.stho.tracks.ui.sensors.RideReplay
import net.stho.tracks.ui.sensors.Sensors
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.upload.UploadQueue
import net.stho.tracks.ui.upload.UploadStatus

/** The ride the harness replays when it is given none: the first 6 km out of Garmisch, with one stop. */
suspend fun bundledRide(): RideReplay = RideReplay.gpx(Res.readBytes("files/rides/garmisch.gpx").decodeToString())

/**
 * M11's only screen: the map, fed by [sensors], with [plan] drawn on it.
 *
 * Not the riding screen (M14) — just enough around the map to exercise it: the heading-up and north-up toggle, follow
 * and overview, a readout of what the sensors and the last tap said, and — given a [recorder] and an [upload] queue — recording's controls and the queue's.
 */
@Composable
fun MapHarness(
    sensors: Sensors,
    plan: List<Coordinate>,
    modifier: Modifier = Modifier.fillMaxSize(),
    recorder: Recorder? = null,
    upload: UploadQueue? = null,
    offline: OfflineData? = null,
    onIdle: () -> Unit = {},
) {
    val style by produceState<MapStyle?>(null) { value = MapStyle.colorful() }
    val fix by remember(sensors) { sensors.fixes }.collectAsState(null)
    val heading by remember(sensors) { sensors.headings }.collectAsState(null)
    val pressure by remember(sensors) { sensors.pressures }.collectAsState(null)
    val ridden by remember(recorder) { recorder?.track ?: flowOf(emptyList()) }.collectAsState(emptyList())
    var orientation by remember { mutableStateOf(Orientation.HeadingUp) }
    var following by remember { mutableStateOf(true) }
    var tapped by remember { mutableStateOf<Coordinate?>(null) }

    Box(modifier.background(Tokens.ground)) {
        style?.let {
            TracksMap(
                style = it,
                camera = if (following) MapCamera.Follow(orientation) else MapCamera.Overview(plan),
                modifier = Modifier.fillMaxSize(),
                plan = plan,
                ridden = ridden,
                fix = fix,
                heading = heading,
                onTap = { at -> tapped = at },
                onIdle = onIdle,
            )
        }

        // Everything at the bottom: the top belongs to the map's attribution, and on the phone to the status bar.
        Column(
            Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            upload?.let { UploadStatus(it) }
            offline?.let { OfflineStatus(it) }
            recorder?.let { RecordingControls(it) }
            Pill {
                val f = fix
                val lines = listOfNotNull(
                    f?.let { "${((it.speedMps ?: 0.0) * 3.6).roundToInt()} km/h · ${it.courseDeg?.let { c -> "${c.roundToInt()}°" } ?: "no course"}" },
                    f?.altitudeM?.let { "${it.roundToInt()} m" + (pressure?.let { p -> " · ${p.hPa.roundToInt()} hPa" } ?: "") },
                    heading?.let { "compass ${it.degrees.roundToInt()}°" },
                    tapped?.let { "tap ${it.lat.fixed(5)}, ${it.lon.fixed(5)}" },
                )
                BasicText(lines.ifEmpty { listOf("waiting for a fix") }.joinToString("\n"), style = TextStyle(color = Tokens.ink, fontSize = 13.sp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(if (orientation == Orientation.HeadingUp) "Heading up" else "North up") {
                    orientation = if (orientation == Orientation.HeadingUp) Orientation.NorthUp else Orientation.HeadingUp
                }
                Button(if (following) "Overview" else "Follow") { following = !following }
            }
        }
    }
}

/** What offline data is doing, while it is doing anything worth a line. Not the plan list's badges (M12): a readout. */
@Composable
private fun OfflineStatus(offline: OfflineData) {
    val state by offline.state.collectAsState()
    val lines = offlineLines(state)
    if (lines.isNotEmpty()) Pill { BasicText(lines.joinToString("\n"), style = TextStyle(color = Tokens.ink, fontSize = 13.sp)) }
}

internal fun offlineLines(state: OfflineState): List<String> = buildList {
    for ((key, area) in state.areas) {
        when (area) {
            AreaState.Waiting -> add("$key: map waiting")
            is AreaState.Downloading -> add("$key: map ${(area.fraction * 100).roundToInt()}%")
            is AreaState.Ready -> add("$key: map offline, ${area.bytes / 1_000_000} MB")
            is AreaState.Failing -> add("$key: map retrying — ${area.message}")
        }
    }
    val downloading = state.downloading
    when {
        downloading != null -> add(
            "routing ${downloading.tile.name}: " +
                (downloading.totalBytes?.let { "${downloading.receivedBytes * 100 / it}%" } ?: "${downloading.receivedBytes / 1_000_000} MB"),
        )
        !state.segmentsWaiting.isNullOrEmpty() -> add("routing: ${state.segmentsWaiting.joinToString { it.name }} waiting")
    }
    state.mapProblem?.let { add("map: $it") }
    when (val problem = state.segmentProblem) {
        null -> Unit
        is SegmentProblem.Unreachable -> add("routing: ${problem.message}")
        is SegmentProblem.StorageFull -> add("routing: ${problem.tile.name} needs ${problem.bytes / 1_000_000} MB, and the phone is nearly full")
    }
}

private fun Double.fixed(digits: Int): String {
    var factor = 1.0
    repeat(digits) { factor *= 10 }
    return ((this * factor).roundToInt() / factor).toString()
}
