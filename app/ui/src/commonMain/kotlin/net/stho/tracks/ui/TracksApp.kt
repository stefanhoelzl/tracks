package net.stho.tracks.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.plan.PlanLink
import net.stho.tracks.plan.derivedName
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.offline.OfflineData
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.plans.HomeScreen
import net.stho.tracks.ui.plans.PlanEditorScreen
import net.stho.tracks.ui.plans.PlanPreview
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.riding.Navigator
import net.stho.tracks.ui.riding.Riding
import net.stho.tracks.ui.sensors.Sensors
import net.stho.tracks.ui.upload.UploadQueue
import kotlinx.coroutines.flow.flowOf

/** What the app needs from the platform it runs on. */
interface AppPlatform {
    /** The text on the clipboard, for Paste link. */
    fun clipboardText(): String?

    /** Hands [url] to whatever the platform shares with: the share sheet on the phone. */
    fun share(url: String)

    /** Keeps the screen from locking itself while [on]: for as long as a ride is recording. The rider locks it. */
    fun keepScreenOn(on: Boolean) {}
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
 * The app: home, the plan a tap opened, the editor — on a stored plan or a new one — and riding.
 *
 * Riding is everything for as long as the [recorder] has a ride — recording, stopped and waiting for *Save ride?*, or
 * found interrupted as the app started — and nothing else is reachable meanwhile. Navigate in a plan's ⋯ menu starts a
 * ride that follows it; home's Ride button starts one with no plan. The screen stays on while a ride records or waits to
 * be saved.
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
    val offlineState by remember(offline) { offline?.state ?: flowOf(null) }.collectAsState(null)
    var open by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<PlanEditor?>(null) }
    val recorded by remember(recorder) { recorder?.state ?: flowOf(RecorderState.Idle) }.collectAsState(RecorderState.Idle)
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val navigator = remember(sensors, library) { Navigator(sensors, library.plans, scope) }
    val riding = recorder != null && recorded != RecorderState.Idle

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
    LaunchedEffect((recorded as? RecorderState.Recording)?.planId) { navigator.follow((recorded as? RecorderState.Recording)?.planId) }
    val screenOn = recorded is RecorderState.Recording || recorded is RecorderState.Stopped
    LaunchedEffect(screenOn) { platform.keepScreenOn(screenOn) }
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

    /** Starts a ride that follows the plan [id], titled with its name, and sets off from wherever the list or view was. */
    fun navigate(id: String) {
        val stored = library.find(id) ?: return
        open = null
        recorder?.start(plan = stored.plan.name.ifEmpty { derivedName(stored.plan) }.ifEmpty { null }, profile = stored.plan.profile.wire, planId = id)
    }

    fun edit(id: String) {
        library.find(id)?.let { editing = PlanEditor(it, router, scope) }
    }

    val editor = editing
    val opened = open?.let { id -> plans.firstOrNull { it.id == id } }
    when {
        riding && recorder != null -> Riding(
            style = style,
            recorder = recorder,
            navigator = navigator,
            sensors = sensors,
            routing = routing,
            modifier = modifier,
            onIdle = onIdle,
        )

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
            onNavigate = recorder?.let { { navigate(opened.id) } },
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
            onRide = recorder?.let { ride -> { ride.start() } },
            onNavigate = recorder?.let { ::navigate },
            onOpen = { open = it },
            onEdit = ::edit,
            onCopy = { id -> scope.launch { library.copy(id) } },
            onShare = ::share,
            onDelete = { id -> scope.launch { library.delete(id) } },
            modifier = modifier,
            offline = offlineState,
            upload = upload,
            onIdle = onIdle,
        )
    }
}
