package net.stho.tracks.ui.riding

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.nearestLeg
import net.stho.tracks.riding.Detour
import net.stho.tracks.riding.RideEdits
import net.stho.tracks.riding.detour
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.plans.PlanEditorScreen
import net.stho.tracks.ui.recording.InterruptedSheet
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.recording.SaveRideSheet
import net.stho.tracks.ui.sensors.Sensors

/**
 * Riding, for as long as the [recorder] has a ride: recording it on the riding screen, asking *Save ride?* once it is
 * stopped, or offering to continue one the app died during.
 *
 * The plan it follows can change on the way, and recording never waits for it:
 *
 * - **A long press** on the map raises the detour dialog. What it makes goes into the leg you are on and is saved over
 *   the plan at once; the leg routes where the library routes, pulsing meanwhile. Undo and Redo take the steps back.
 * - **Edit plan** opens the editor over the ride, as it is from the list: Save overwrites the plan and is one more step
 *   to undo; Copy saves it as a new plan, and the ride follows the copy from then on; Cancel leaves the plan as it was.
 *
 * [navigator] must already follow the plan the ride does. [sensors] are the ones the recorder reads, and [router] the
 * one the [library] routes with.
 */
@Composable
fun Riding(
    style: MapStyle?,
    recorder: Recorder,
    navigator: Navigator,
    sensors: Sensors,
    library: PlanLibrary,
    router: LegRouting,
    geocoder: PhotonGeocoder,
    modifier: Modifier = Modifier,
    onIdle: () -> Unit = {},
) {
    val state by recorder.state.collectAsState()
    val fix by remember(sensors) { sensors.fixes }.collectAsState(null)
    val heading by remember(sensors) { sensors.headings }.collectAsState(null)
    val ridden by recorder.track.collectAsState()
    val elevation by recorder.elevation.collectAsState()
    val navigation by navigator.state.collectAsState()
    val routing by library.routing.collectAsState()
    val recording = state as? RecorderState.Recording
    val planId = recording?.planId
    val scope = rememberCoroutineScope()

    val edits = remember(planId) { planId?.let { RideEdits(library, it) } }
    val undoState by remember(edits) { edits?.state ?: flowOf(RideEdits.State()) }.collectAsState(RideEdits.State())
    var target by remember { mutableStateOf<DetourTarget?>(null) }
    var editing by remember { mutableStateOf<PlanEditor?>(null) }

    val editor = editing
    if (editor != null && recording != null) {
        val before = remember(editor) { library.find(editor.id) }
        PlanEditorScreen(
            style = style,
            editor = editor,
            geocoder = geocoder,
            fix = fix,
            onCancel = {
                editor.close()
                editing = null
            },
            onSave = {
                scope.launch {
                    editor.save(library)
                    before?.let { edits?.edited(it) }
                    editing = null
                }
            },
            onCopy = {
                scope.launch {
                    val copy = editor.saveAsNew(library)
                    recorder.follow(copy.id)
                    editing = null
                }
            },
            modifier = modifier,
            onIdle = onIdle,
        )
        return
    }

    fun place(chosen: DetourTarget, kind: Detour) {
        target = null
        val following = navigation ?: return
        val stored = library.find(following.plan.id) ?: return
        val leg = following.progress?.leg ?: nearestLeg(stored.plan, stored.legs, chosen.at)
        val next = detour(stored.plan, stored.legs, leg, chosen.at, kind, chosen.name)
        scope.launch {
            edits?.update(next)
            // A stop with no name from the map is named online, as the editor names one; offline it stays unnamed.
            if (kind == Detour.Through || chosen.name != null) return@launch
            // The stop as it was saved: where the link's precision put it.
            val placed = library.find(following.plan.id)?.plan?.waypoints
                ?.firstOrNull { it.kind == WaypointKind.Poi && it.name == null && near(it, chosen.at) } ?: return@launch
            val found = try {
                geocoder.reverse(Coordinate(placed.lat, placed.lon))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            } ?: return@launch
            edits?.nameFound(placed, found)
        }
    }

    RidingScreen(
        style = style,
        fix = fix,
        heading = heading,
        ridden = ridden,
        navigation = navigation.takeIf { planId != null },
        routing = navigation?.let { routing[it.plan.id] },
        elevation = elevation,
        stats = recording?.let { RideStats(it.paused, it.distanceM, it.climbedM) },
        onPause = recorder::pause,
        onResume = recorder::resume,
        onStop = recorder::stop,
        modifier = modifier,
        onLongPlace = if (planId != null) { at, name -> target = DetourTarget(at, name) } else null,
        onEditPlan = planId?.let { id ->
            {
                target = null
                library.find(id)?.let { editing = PlanEditor(it, router, scope) }
            }
        },
        undo = edits?.let { UndoControls(undoState.canUndo, undoState.canRedo, { scope.launch { it.undo() } }, { scope.launch { it.redo() } }) },
        onIdle = onIdle,
    ) {
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(12.dp)) {
            when (val asked = state) {
                is RecorderState.Stopped -> SaveRideSheet(asked, onSave = recorder::save, onDiscard = recorder::discard)
                is RecorderState.Interrupted -> InterruptedSheet(asked, onContinue = recorder::continueRide, onStop = recorder::stop)
                else -> target?.let { chosen ->
                    DetourDialog(chosen, onDetour = { place(chosen, it) }, onClose = { target = null })
                }
            }
        }
    }
}

/** Whether a waypoint is where a place was picked, as its link's precision rounds it. */
private fun near(waypoint: Waypoint, at: Coordinate) = abs(waypoint.lat - at.lat) < 1e-4 && abs(waypoint.lon - at.lon) < 1e-4
