package net.stho.tracks.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.plan.PlanLink
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.harness.MapHarness
import net.stho.tracks.ui.offline.OfflineData
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.plans.HomeScreen
import net.stho.tracks.ui.plans.PlanEditorScreen
import net.stho.tracks.ui.plans.PlanPreview
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.sensors.Sensors
import net.stho.tracks.ui.theme.Pill
import net.stho.tracks.ui.upload.UploadQueue

/** What the app needs from the platform it runs on. */
interface AppPlatform {
    /** The text on the clipboard, for Paste link. */
    fun clipboardText(): String?

    /** Hands [url] to whatever the platform shares with: the share sheet on the phone. */
    fun share(url: String)
}

/** What became of some text that may have held a plan link. */
sealed interface Intake {
    data class Kept(val plan: StoredPlan) : Intake

    data object NoLink : Intake

    data class Broken(val reason: String) : Intake
}

/** Keeps the plan in [text], if it holds a Tracks plan link. However it arrived — pasted, shared, opened — it lands here. */
suspend fun PlanLibrary.receiveLink(text: String?): Intake {
    val plan = try {
        PlanLink.find(text ?: "")
    } catch (e: IllegalArgumentException) {
        return Intake.Broken(e.message ?: "it could not be read")
    } ?: return Intake.NoLink
    return Intake.Kept(receive(plan))
}

/**
 * The app: home, the plan a tap opened, the editor — on a stored plan or a new one — and recording, which home's Ride button opens.
 *
 * [router] must be the one the [library] routes with — there is one engine, and one route runs at a time. [sensors]
 * must be shared when there is a [recorder]: the map and the recorder read one stream, or a replay would be two rides.
 * [links] is text arriving from outside: a universal link, or the harness's `--paste`. Loading a plan never starts
 * anything: it lands in the list.
 */
@Composable
fun TracksApp(
    library: PlanLibrary,
    router: LegRouting,
    geocoder: PhotonGeocoder,
    sensors: Sensors,
    platform: AppPlatform,
    modifier: Modifier = Modifier.fillMaxSize(),
    recorder: Recorder? = null,
    upload: UploadQueue? = null,
    offline: OfflineData? = null,
    links: Flow<String> = emptyFlow(),
    onIdle: () -> Unit = {},
) {
    val style by produceState<MapStyle?>(null) { value = MapStyle.colorful() }
    val fix by remember(sensors) { sensors.fixes }.collectAsState(null)
    val plans by library.plans.collectAsState()
    val routing by library.routing.collectAsState()
    var open by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<PlanEditor?>(null) }
    var riding by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun intake(text: String?) {
        scope.launch {
            notice = when (val result = library.receiveLink(text)) {
                is Intake.Kept -> null
                Intake.NoLink -> "There is no Tracks plan link on the clipboard."
                is Intake.Broken -> "That plan link is broken: ${result.reason}"
            }
        }
    }

    LaunchedEffect(library) { library.start() }
    LaunchedEffect(links) { links.collect { intake(it) } }
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(8.seconds)
            notice = null
        }
    }

    fun share(id: String) {
        library.find(id)?.let { platform.share(PlanLink.format(it.plan)) }
    }

    fun edit(id: String) {
        library.find(id)?.let { editing = PlanEditor(it, router, scope) }
    }

    val editor = editing
    val opened = open?.let { id -> plans.firstOrNull { it.id == id } }
    when {
        riding && recorder != null -> Box(modifier) {
            // M15's recording screen, as it shipped: record, pause, stop, Save ride?, and the upload queue.
            MapHarness(sensors = sensors, plan = emptyList(), recorder = recorder, upload = upload, offline = offline, onIdle = onIdle)
            Pill(
                "‹ Plans",
                onClick = { riding = false },
                primary = false,
                // Under the map's attribution, which holds the top edge.
                modifier = Modifier.align(Alignment.TopStart).windowInsetsPadding(WindowInsets.safeDrawing).padding(start = 16.dp, top = 64.dp),
            )
        }

        editor != null -> PlanEditorScreen(
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
                    open = editor.save(library).id
                    editing = null
                }
            },
            onCopy = {
                scope.launch {
                    open = editor.saveAsNew(library).id
                    editing = null
                }
            },
            modifier = modifier,
            onIdle = onIdle,
        )

        opened != null -> PlanPreview(
            style = style,
            stored = opened,
            routing = routing[opened.id],
            fix = fix,
            onBack = { open = null },
            onEdit = { edit(opened.id) },
            onCopy = { scope.launch { open = library.copy(opened.id)?.id ?: open } },
            onShare = { share(opened.id) },
            onDelete = {
                open = null
                scope.launch { library.delete(opened.id) }
            },
            modifier = modifier,
            onIdle = onIdle,
        )

        else -> HomeScreen(
            style = style,
            fix = fix,
            plans = plans,
            routing = routing,
            notice = notice,
            onNew = { editing = PlanEditor.blank(router, scope) },
            onPaste = { intake(platform.clipboardText()) },
            onRide = recorder?.let { { riding = true } },
            onOpen = { open = it },
            onEdit = ::edit,
            onCopy = { id -> scope.launch { library.copy(id) } },
            onShare = ::share,
            onDelete = { id -> scope.launch { library.delete(id) } },
            modifier = modifier,
            onIdle = onIdle,
        )
    }
}
