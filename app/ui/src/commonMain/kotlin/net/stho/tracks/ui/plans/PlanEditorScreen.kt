package net.stho.tracks.ui.plans

import net.stho.tracks.ui.theme.SheetDetent
import net.stho.tracks.ui.map.Pinned
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Placement
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.addWaypoint
import net.stho.tracks.plan.derivedName
import net.stho.tracks.plan.insertionAt
import net.stho.tracks.plan.kindIsAChoice
import net.stho.tracks.plan.legGeometries
import net.stho.tracks.plan.moveStop
import net.stho.tracks.plan.moveWaypoint
import net.stho.tracks.plan.nearestLeg
import net.stho.tracks.plan.placementAt
import net.stho.tracks.plan.planBounds
import net.stho.tracks.plan.planTotals
import net.stho.tracks.plan.Range
import net.stho.tracks.plan.sliceBetween
import net.stho.tracks.plan.nearestDrawn
import net.stho.tracks.plan.planTrack
import net.stho.tracks.plan.removeWaypoint
import net.stho.tracks.plan.setKind
import net.stho.tracks.plan.terrainOf
import net.stho.tracks.plan.updateWaypoint
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.store.PlanEditor
import net.stho.tracks.ui.map.LegLine
import net.stho.tracks.ui.map.LegState
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.PlanDrawing
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.ui.map.UNDER_MAP_CREDIT
import net.stho.tracks.ui.map.WaypointMark
import net.stho.tracks.sensors.Fix
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.SnapSheet
import net.stho.tracks.ui.theme.StatTile
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

private const val SHEET_SHARE = 0.5f

/**
 * The plan editor: the web's rules, on a phone.
 *
 * A tap on the map raises the one dialog that commits a waypoint — a stop, where to put it, or a shaping point in the
 * nearest leg — and names a stop from the map label under the tap, so it works with no signal. A waypoint's marker
 * drags once a long press picks it up, so a pinch never moves one; a tap on it edits it. A long press on the map drops a
 * shaping point into the nearest leg, the phone's way of dragging the line. While a marker drags the plan draws as
 * straight lines, and it routes once it is let go.
 *
 * Only the legs an edit touches route again, on the phone, drawn meanwhile as the dashed, pulsing beeline. Undo and Redo
 * float over the map's corner while there is a step to take. Save overwrites the plan; Copy keeps it and saves this as
 * a new one.
 *
 * A new plan opens on you, as home does, with nothing but Save and Cancel — and Save only once it has a start and an end.
 */
@Composable
fun PlanEditorScreen(
    style: MapStyle?,
    editor: PlanEditor,
    geocoder: PhotonGeocoder,
    fix: Fix?,
    onCancel: () -> Unit,
    onSave: () -> Unit,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier,
    pulse: Boolean = true,
    initiallyExpanded: Boolean = false,
    /** The dialog open as the screen appears: for the screenshots. */
    initialDialog: PinTarget? = null,
    onIdle: () -> Unit = {},
) {
    var detent by remember { mutableStateOf(if (initiallyExpanded) SheetDetent.Full else SheetDetent.Header) }
    var covered by remember { mutableStateOf(0.dp) }
    /** How much of the screen the sheet covers where it rests: what the pinned dialog stays clear of. */
    var sheetCovers by remember { mutableStateOf(0.dp) }
    // The first height the header was measured at: a header that grows while editing must not move the map.
    var firstCovered by remember { mutableStateOf<Dp?>(null) }
    val state by editor.state.collectAsState()
    val plan = state.plan
    val legs = state.legs
    var dialog by remember { mutableStateOf(initialDialog) }
    var base by remember { mutableIntStateOf(0) }
    var dragging by remember { mutableStateOf<Pair<Int, Coordinate>?>(null) }
    /** Where the profile's bar stands, in metres along the plan; the map rings that place. */
    var pickedM by remember { mutableStateOf<Double?>(null) }
    /** The stretch two bars enclose, which the map draws at full strength over a line held back. */
    var selected by remember { mutableStateOf<Range?>(null) }
    // The place under the bar, found through the profile's own drawn points so the ring lands where the dot does.
    val editorTrack = remember(legs) { planTrack(legs) }
    val editorTerrain = remember(editorTrack, legs) {
        terrainOf(editorTrack, planTotals(legs).distanceM.takeIf { it > 0 })
    }
    val picked = pickedM?.let { alongM ->
        editorTerrain?.let { terrain ->
            editorTrack.coordinates.getOrNull(terrain.trackIndex[nearestDrawn(terrain.distances, alongM)])
        }
    }
    // Measured along the drawn points, which is what the profile's own distances are measured along.
    val highlighted = remember(editorTerrain, selected) {
        val range = selected
        val terrain = editorTerrain
        if (range == null || terrain == null) {
            emptyList()
        } else {
            sliceBetween(terrain.trackIndex.map { editorTrack.coordinates[it] }, terrain.distances, range.fromM, range.toM)
        }
    }
    val scope = rememberCoroutineScope()

    // Where the camera looks is decided once, as the editor opens: an edit must not move the map under a finger.
    val frame = remember {
        planBounds(plan.waypoints, legs)?.let { listOf(Coordinate(it.south, it.west), Coordinate(it.north, it.east)) } ?: emptyList()
    }

    val drawing = remember(state, dragging, pulse) {
        val moving = dragging
        if (moving != null) {
            // A drag repaints as straight lines and asks nothing of the engine until it is let go.
            val waypoints = plan.waypoints.mapIndexed { index, w -> if (index == moving.first) w.copy(lat = moving.second.lat, lon = moving.second.lon) else w }
            PlanDrawing(
                legs = waypoints.zipWithNext { a, b -> LegLine(listOf(Coordinate(a.lat, a.lon), Coordinate(b.lat, b.lon)), LegState.Unroutable) },
                waypoints = waypoints.map { WaypointMark(Coordinate(it.lat, it.lon), it.kind == WaypointKind.Poi, it.name ?: "") },
                pulse = pulse,
            )
        } else {
            PlanDrawing(
                legs = legGeometries(plan.waypoints, legs).mapIndexed { index, line ->
                    LegLine(
                        line,
                        when {
                            legs[index] is RoutedLeg -> LegState.Routed
                            index in state.routing -> LegState.Routing
                            else -> LegState.Unroutable
                        },
                    )
                },
                waypoints = plan.waypoints.map { WaypointMark(Coordinate(it.lat, it.lon), it.kind == WaypointKind.Poi, it.name ?: "") },
                pulse = pulse,
            )
        }
    }

    fun add(target: PinTarget.New, kind: WaypointKind, placement: Placement) {
        val index = placementAt(plan, legs, placement, target.leg, target.at)
        val name = if (kind == WaypointKind.Poi) target.name else null
        editor.update(addWaypoint(plan, Waypoint(target.at.lat, target.at.lon, kind, name), index))
        dialog = null

        // A stop with no name yet is named lazily, online, as on the web; offline it keeps the map's label or none.
        if (kind == WaypointKind.Poi && name == null) {
            val placed = editor.state.value.plan.waypoints.getOrNull(index) ?: return
            scope.launch {
                val found = try {
                    geocoder.reverse(Coordinate(placed.lat, placed.lon))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    null
                } ?: return@launch
                editor.nameFound(placed, found)
            }
        }
    }

    fun pin(at: Coordinate, name: String?) {
        val leg = nearestLeg(plan, legs, at)
        val target = PinTarget.New(at, leg, name)
        // An empty plan's only answer is where it starts, so its first waypoint is added without asking — the web's
        // rule: a dialog with one choice in it is a question with one answer.
        if (plan.waypoints.isEmpty()) add(target, WaypointKind.Poi, Placement.End) else dialog = target
    }

    // The dialog stands on its waypoint, as the web's does: over the place a tap chose, or on the stop being edited.
    val topInset = WindowInsets.safeDrawing.asPaddingValues().calculateTopPadding()
    val pinned = dialog?.let { target ->
        val at = when (target) {
            is PinTarget.New -> target.at
            is PinTarget.Edit -> plan.waypoints.getOrNull(target.index)?.let { Coordinate(it.lat, it.lon) }
        }
        at?.let {
            Pinned(it, inset = PaddingValues(top = topInset + UNDER_MAP_CREDIT, bottom = sheetCovers)) {
                WaypointDialog(
                    target = target,
                    kindIsAChoice = kindIsAChoice(plan),
                    onAdd = { kind, placement -> if (target is PinTarget.New) add(target, kind, placement) },
                    onKind = { kind ->
                        if (target is PinTarget.Edit) editor.update(setKind(plan, target.index, kind))
                        dialog = null
                    },
                    onRename = { name ->
                        if (target is PinTarget.Edit) editor.update(updateWaypoint(plan, target.index) { it.copy(name = name.ifEmpty { null }) })
                    },
                    onRemove = {
                        if (target is PinTarget.Edit) editor.update(removeWaypoint(plan, target.index))
                        dialog = null
                    },
                    onClose = { dialog = null },
                )
            }
        }
    }

    BoxWithConstraints(modifier.fillMaxSize().background(Tokens.ground)) {
        style?.let {
            TracksMap(
                style = it,
                // Framed clear of the minimised sheet: the map is where a plan is edited. With nothing to frame, on you.
                camera = if (frame.isEmpty()) {
                    MapCamera.Centre(zoom = 13.0, inset = PaddingValues(bottom = firstCovered ?: 0.dp))
                } else {
                    MapCamera.Overview(frame, inset = PaddingValues(start = 32.dp, top = UNDER_MAP_CREDIT + 48.dp, end = 32.dp, bottom = covered + 32.dp))
                },
                modifier = Modifier.fillMaxSize(),
                fix = fix,
                drawing = drawing,
                onPlace = { at, label -> pin(at, label) },
                onLongPress = { at ->
                    nearestLeg(plan, legs, at)?.let { leg ->
                        editor.update(addWaypoint(plan, Waypoint(at.lat, at.lon, WaypointKind.Routing, null), insertionAt(plan, legs, leg, at)))
                    }
                },
                onWaypointTap = { index -> plan.waypoints.getOrNull(index)?.let { dialog = PinTarget.Edit(index, it) } },
                onWaypointDrag = { index, at, done ->
                    if (done) {
                        dragging = null
                        editor.update(moveWaypoint(plan, index, at))
                    } else {
                        dragging = index to at
                    }
                },
                marker = picked,
                highlight = highlighted,
                onIdle = onIdle,
                pinned = pinned,
            )
        }

        // Each in a slot of its own, so neither moves as the other comes and goes; while a dialog holds a waypoint by
        // its index, they wait for it to close.
        if (dialog == null) {
            Row(
                Modifier.align(Alignment.TopEnd).windowInsetsPadding(WindowInsets.safeDrawing).padding(end = 16.dp, top = UNDER_MAP_CREDIT),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(44.dp)) { if (state.canUndo) IconButton(Icons.Undo, "Undo", editor::undo, tint = Tokens.bad) }
                Box(Modifier.size(44.dp)) { if (state.canRedo) IconButton(Icons.Redo, "Redo", editor::redo, tint = Tokens.accent) }
            }
        }

        val stops = plan.waypoints.count { it.kind == WaypointKind.Poi }
        SnapSheet(
            detent = detent,
            onDetent = { detent = it },
            // All three, as the web's sheet has: the map and the stops both in view is how a plan is edited.
            detents = listOf(SheetDetent.Header, SheetDetent.Half, SheetDetent.Full),
            onCovered = { sheetCovers = it },
            onHeaderHeight = {
                covered = it
                if (firstCovered == null && it > 0.dp) firstCovered = it
            },
            header = {
                // Save is offered once there is something to save; Cancel always is, and Copy whenever there is a plan to keep.
                val actions = listOfNotNull(
                    MenuEntry(Icons.Save, "Save", onSave, tint = Tokens.accent).takeIf { state.saveable },
                    MenuEntry(Icons.Copy, "Copy", onCopy).takeUnless { editor.new },
                    MenuEntry(Icons.Close, "Cancel", onCancel),
                )
                EditorHeader(plan, legs.size, stops, editor, state, actions)
            },
        ) {
            if (stops < 2) {
                BasicText(
                    "Tap the map to start. The first two points are the start and the end; after that, add stops, or long-press the map to shape the route.",
                    style = Type.note,
                )
            } else {
                val totals = planTotals(legs)
                PlanTiles(legs)
                editorTerrain?.let { terrain ->
                    // The same bar and the same stretch the riding sheet has: a plan is read the way a ride is.
                    ElevationProfile(
                        terrain,
                        pickedM = pickedM,
                        onPick = { alongM -> pickedM = alongM },
                        onRange = { selected = it },
                    )
                }
            }

            BasicText("PROFILE", style = Type.label)
            ProfilePills(plan.profile, onSelect = { editor.update(plan.copy(profile = it)) })

            PlaceSearch(
                geocoder = geocoder,
                near = { fix?.at ?: plan.waypoints.firstOrNull()?.let { Coordinate(it.lat, it.lon) } },
                onPick = { place -> pin(Coordinate(place.lat, place.lon), place.name) },
            )

            if (plan.waypoints.isNotEmpty()) {
                BasicText("ROUTE", style = Type.label)
                StopList(
                    plan = plan,
                    legs = legs,
                    base = base.coerceIn(0, maxOf(0, stops - 1)),
                    onBase = { base = it },
                    onEdit = { index -> dialog = PinTarget.Edit(index, plan.waypoints[index]) },
                    // No × on the rows: a delete that can be hit while scrolling the list is worse than one tap further
                    // away, so Remove is in the stop's dialog, as on the web.
                    onRemove = null,
                    onMoveStop = { from, to -> editor.update(moveStop(plan, from, to)) },
                )
            }
        }

    }
}

/**
 * What the minimised editor still shows: the name, where it can be typed, the plan in one line, and what the engine is
 * doing — the thing to glance at while the map is being edited.
 */
@Composable
private fun EditorHeader(
    plan: net.stho.tracks.plan.Plan,
    legCount: Int,
    stops: Int,
    editor: PlanEditor,
    state: PlanEditor.State,
    actions: List<MenuEntry>,
) {
    Row(verticalAlignment = Alignment.Top) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        BasicTextField(
            value = plan.name,
            onValueChange = { editor.update(plan.copy(name = it)) },
            singleLine = true,
            textStyle = Type.title,
            cursorBrush = SolidColor(Tokens.accent),
            decorationBox = { field ->
                Box {
                    if (plan.name.isEmpty()) BasicText(derivedName(plan).ifEmpty { "Name this plan" }, style = Type.title.copy(color = Tokens.muted))
                    field()
                }
            },
        )
        BasicText(
            "$stops stops · $legCount ${if (legCount == 1) "leg" else "legs"} · brouter · ${plan.profile.label.lowercase()}",
            style = Type.mono,
        )
        editorNote(state)?.let { BasicText(it, style = Type.note, modifier = Modifier.padding(top = 4.dp)) }
    }
    ActionMenu(actions)
    }
}

/** The one line to say about the legs while editing, most urgent first. A leg routing says so itself: its dash pulses. */
private fun editorNote(state: PlanEditor.State): String? = when {
    state.errors.isNotEmpty() -> "The router failed: ${state.errors.values.first()}"
    state.noData.isNotEmpty() -> "No routing data for part of this plan on the phone yet, so these totals are short by it."
    state.legs.any { it is FailedLeg } -> "One leg could not be routed, so these totals are short by it."
    else -> null
}
