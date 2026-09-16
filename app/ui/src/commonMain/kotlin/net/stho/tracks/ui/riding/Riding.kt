package net.stho.tracks.ui.riding

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.recording.InterruptedSheet
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.recording.SaveRideSheet
import net.stho.tracks.ui.sensors.Sensors

/**
 * Riding, for as long as the [recorder] has a ride: recording it on the riding screen, asking *Save ride?* once it is
 * stopped, or offering to continue one the app died during.
 *
 * [navigator] must already follow the plan the ride does. [sensors] are the ones the recorder reads.
 */
@Composable
fun Riding(
    style: MapStyle?,
    recorder: Recorder,
    navigator: Navigator,
    sensors: Sensors,
    routing: Map<String, PlanRouting>,
    modifier: Modifier = Modifier,
    onIdle: () -> Unit = {},
) {
    val state by recorder.state.collectAsState()
    val fix by remember(sensors) { sensors.fixes }.collectAsState(null)
    val heading by remember(sensors) { sensors.headings }.collectAsState(null)
    val ridden by recorder.track.collectAsState()
    val elevation by recorder.elevation.collectAsState()
    val navigation by navigator.state.collectAsState()
    val recording = state as? RecorderState.Recording

    RidingScreen(
        style = style,
        fix = fix,
        heading = heading,
        ridden = ridden,
        navigation = navigation.takeIf { recording?.planId != null },
        routing = navigation?.let { routing[it.plan.id] },
        elevation = elevation,
        stats = recording?.let { RideStats(it.paused, it.distanceM, it.climbedM) },
        onPause = recorder::pause,
        onResume = recorder::resume,
        onStop = recorder::stop,
        modifier = modifier,
        onIdle = onIdle,
    ) {
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(12.dp)) {
            when (val asked = state) {
                is RecorderState.Stopped -> SaveRideSheet(asked, onSave = recorder::save, onDiscard = recorder::discard)
                is RecorderState.Interrupted -> InterruptedSheet(asked, onContinue = recorder::continueRide, onStop = recorder::stop)
                else -> Unit
            }
        }
    }
}
