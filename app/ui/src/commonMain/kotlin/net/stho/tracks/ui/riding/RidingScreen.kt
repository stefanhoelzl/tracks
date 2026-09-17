package net.stho.tracks.ui.riding

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation as DragOrientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Terrain
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.riding.Reading
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.Orientation
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.ui.map.UNDER_MAP_CREDIT
import net.stho.tracks.ui.plans.ActionMenu
import net.stho.tracks.ui.plans.ElevationProfile
import net.stho.tracks.ui.plans.MenuEntry
import net.stho.tracks.ui.plans.planDrawing
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** How close the riding map follows you: about 1.7 km of road across a phone. Following always comes back to it. */
const val RIDING_ZOOM = 15.0

/** A page collapsed, fixed: a line and a strip. A page change must not change what the map is inset by. */
private val COLLAPSED_PAGE = 54.dp

/** A page open, fixed: the same line, over a profile with room to read the climbs. */
private val OPEN_PAGE = 204.dp

private val STRIP_HEIGHT = 30.dp
private val OPEN_PROFILE_HEIGHT = 180.dp

/** The riding profile's least height: short stretches are what it mostly draws, and 200 m flattens them. */
private const val PROFILE_MIN_SPAN_M = 100.0

/** A drag on the sheet further than this, or a fling, opens or collapses it. */
private val SNAP_DRAG = 24.dp

/** Paused: the web's warning amber, since a paused ride is one that is not being recorded. */
private val PAUSED = Color(0xFFCE7A0C)

/** Undo and Redo over the riding map, while there is a step to take. */
data class UndoControls(val canUndo: Boolean, val canRedo: Boolean, val onUndo: () -> Unit, val onRedo: () -> Unit)

/** The ride so far, as recorded: what the stats line reads. */
data class RideStats(val paused: Boolean, val distanceM: Double, val climbedM: Double?, val movingMillis: Long = 0)

/**
 * The screen you ride with: the map turned with you, under one sheet with what is ahead of you on the plan you follow.
 *
 * - **The pages** are the stops still ahead, one each and the finish last: its name, the distance and climb from where
 *   you are to it, and the profile of that stretch, with a tick at each stop on the way. They swipe; a new next stop
 *   brings the first page back.
 * - **The stats line**, fixed under them, is the ride so far: speed, average speed over the time moving, metres climbed,
 *   distance.
 * - **⋯** holds Pause (or Resume), Edit plan and Stop. While paused, a chip over the map says so, and resumes.
 *
 * The sheet is collapsed — a page is a line and a strip — or [expanded], the same line over a profile with more height to
 * it; a drag or a tap on its top switches, and [onExpanded] is told.
 *
 * A total across a leg that is not routed counts what is routed and says so with a `+`; the leg itself is its dash on
 * the map and a gap in the profile. There is no cue for being off the route: the map shows it.
 *
 * Without a [navigation] it is a ride with no plan: one page, the profile of the ride so far, [elevation]. Without
 * [stats] — a ride stopped, or found interrupted — there is no sheet at all, and [sheet] is what asks about it.
 *
 * The map follows you heading-up, your dot in the lower third of what the sheet leaves, at [RIDING_ZOOM]; the compass
 * button turns it north-up and back. A pan or a pinch leaves the map where the finger put it, and the button — grey
 * then — follows you again. A tap on the map does nothing here: a long press is a detour, [onLongPlace], so a bump or a
 * glove cannot make one. Undo and Redo sit top left while there is a step to take.
 *
 * A tap on a stop's profile picks that place on the route: the map leaves following to show it, ringed, and the profile
 * marks it. Following again — the grey button — lets it go.
 */
@Composable
fun RidingScreen(
    style: MapStyle?,
    fix: Fix?,
    heading: Heading?,
    ridden: List<Coordinate>,
    navigation: Navigation?,
    routing: PlanRouting?,
    elevation: Terrain?,
    stats: RideStats?,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    expanded: Boolean = false,
    onExpanded: (Boolean) -> Unit = {},
    onLongPlace: ((Coordinate, String?) -> Unit)? = null,
    onEditPlan: (() -> Unit)? = null,
    undo: UndoControls? = null,
    pulse: Boolean = true,
    /** The ⋯ menu open as the screen appears: for the screenshots. */
    menuOpen: Boolean = false,
    /** A place on the route picked as the screen appears, in metres along it: for the screenshots. */
    initiallyPickedM: Double? = null,
    onIdle: () -> Unit = {},
    sheet: @Composable BoxScope.() -> Unit = {},
) {
    var orientation by remember { mutableStateOf(Orientation.HeadingUp) }
    var manual by remember { mutableStateOf(initiallyPickedM != null) }
    // Metres along the route, not along a page: it stays put as you ride, whichever page shows it.
    var pickedM by remember { mutableStateOf(initiallyPickedM) }
    val picked = remember(navigation?.route, pickedM) { pickedM?.let { navigation?.route?.pointAt(it) } }
    LaunchedEffect(manual) { if (!manual) pickedM = null }
    var sheetHeight by remember { mutableStateOf(0.dp) }
    val density = LocalDensity.current
    val stored = navigation?.plan
    val drawing = remember(stored, routing, pulse) { stored?.let { planDrawing(it, routing, pulse) } }
    // What is not drawn covers nothing: the map is inset by what is on the screen.
    LaunchedEffect(stats != null) { if (stats == null) sheetHeight = 0.dp }

    BoxWithConstraints(modifier.fillMaxSize().background(Tokens.ground)) {
        val topInset = with(density) { WindowInsets.safeDrawing.getTop(this).toDp() }
        // The buttons float over the map, and cover nothing the camera keeps clear of: only the credit and the sheet do.
        val top = topInset + UNDER_MAP_CREDIT
        val gap = (maxHeight - top - sheetHeight).coerceAtLeast(0.dp)

        style?.let {
            TracksMap(
                style = it,
                // Centred in what the inset leaves: a top inset a third of the gap down puts you two thirds down it.
                camera = when {
                    !manual -> MapCamera.Follow(orientation, RIDING_ZOOM, PaddingValues(top = top + gap / 3, bottom = sheetHeight))
                    picked != null -> MapCamera.Show(picked, PaddingValues(top = top, bottom = sheetHeight))
                    else -> MapCamera.Free
                },
                modifier = Modifier.fillMaxSize(),
                ridden = ridden,
                fix = fix,
                heading = heading,
                drawing = drawing,
                onLongPlace = onLongPlace,
                onGesture = { manual = true },
                marker = picked,
                onIdle = onIdle,
            )
        }

        Row(
            Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .padding(start = 12.dp, end = 12.dp, top = UNDER_MAP_CREDIT),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Each in a slot of its own, so neither moves as the other comes and goes.
            Box(Modifier.size(44.dp)) { if (undo?.canUndo == true) IconButton(Icons.Undo, "Undo", undo.onUndo, primary = false) }
            Box(Modifier.size(44.dp)) { if (undo?.canRedo == true) IconButton(Icons.Redo, "Redo", undo.onRedo, primary = false) }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                if (stats?.paused == true) PausedChip(onResume)
            }
            when {
                manual -> IconButton(Icons.Locate, "Follow me again", onClick = { manual = false }, primary = false)
                orientation == Orientation.HeadingUp ->
                    IconButton(Icons.Navigate, "Heading up; turn north up", onClick = { orientation = Orientation.NorthUp })
                else -> IconButton(Icons.NorthUp, "North up; turn heading up", onClick = { orientation = Orientation.HeadingUp })
            }
        }

        if (stats != null) {
            RideSheet(
                navigation = navigation,
                elevation = elevation,
                fix = fix,
                stats = stats,
                expanded = expanded,
                onExpanded = onExpanded,
                menu = listOfNotNull(
                    if (stats.paused) MenuEntry(Icons.Resume, "Resume", onResume, fill = Tokens.accent) else MenuEntry(Icons.Pause, "Pause", onPause),
                    onEditPlan?.takeIf { navigation != null }?.let { MenuEntry(Icons.Edit, "Edit plan", it) },
                    MenuEntry(Icons.StopRide, "Stop", onStop, fill = Tokens.ink),
                ),
                menuOpen = menuOpen,
                pickedM = pickedM,
                onPick = { alongM ->
                    pickedM = alongM
                    manual = true
                },
                modifier = Modifier.align(Alignment.BottomCenter).onSizeChanged { sheetHeight = with(density) { it.height.toDp() } },
            )
        }

        sheet()
    }
}

@Composable
private fun PausedChip(onResume: () -> Unit) {
    Box(
        Modifier.background(PAUSED, Shapes.pill).clickable(onClick = onResume).semantics { contentDescription = "Paused; resume" }
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        BasicText("PAUSED · RESUME", style = Type.label.copy(color = Tokens.surface), maxLines = 1)
    }
}

/** The one sheet: its top with the page dots and ⋯, the pages, and the stats line. */
@Composable
private fun RideSheet(
    navigation: Navigation?,
    elevation: Terrain?,
    fix: Fix?,
    stats: RideStats,
    expanded: Boolean,
    onExpanded: (Boolean) -> Unit,
    menu: List<MenuEntry>,
    menuOpen: Boolean,
    pickedM: Double?,
    onPick: (Double) -> Unit,
    modifier: Modifier,
) {
    val snap = with(LocalDensity.current) { SNAP_DRAG.toPx() }
    var dragged by remember { mutableFloatStateOf(0f) }
    val progress = navigation?.progress
    val first = progress?.nextStop
    val pages = if (navigation != null && progress != null && first != null) progress.ahead.size else 1

    Column(
        modifier
            .fillMaxWidth()
            .background(Tokens.glassHi, Shapes.sheet)
            .draggable(
                state = rememberDraggableState { dragged += it },
                orientation = DragOrientation.Vertical,
                onDragStarted = { dragged = 0f },
                onDragStopped = { velocity ->
                    when {
                        dragged < -snap || velocity < -800f -> onExpanded(true)
                        dragged > snap || velocity > 800f -> onExpanded(false)
                    }
                },
            )
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .animateContentSize()
            .padding(start = 14.dp, end = 6.dp, bottom = 10.dp),
    ) {
        // Back to the first page whenever the next stop changes, or the plan does.
        key(navigation?.plan?.id, first) {
            val pager = rememberPagerState { pages }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onExpanded(!expanded) }
                    .semantics { contentDescription = if (expanded) "Collapse" else "Expand" },
            ) {
                Box(Modifier.align(Alignment.Center).width(36.dp).height(5.dp).background(Tokens.line2, Shapes.pill))
                if (pages > 1) Dots(pager, Modifier.align(Alignment.CenterStart))
                ActionMenu(menu, Modifier.align(Alignment.CenterEnd), initiallyOpen = menuOpen, opensUp = true)
            }
            HorizontalPager(pager, Modifier.fillMaxWidth().padding(end = 8.dp).height(if (expanded) OPEN_PAGE else COLLAPSED_PAGE)) { page ->
                Column(Modifier.fillMaxSize()) {
                    if (navigation == null) RideSoFar(elevation, expanded) else StopPage(navigation, page, expanded, pickedM, onPick)
                }
            }
        }
        StatsRow(fix, stats, Modifier.padding(end = 8.dp))
    }
}

/** From where you are to the stop [page] places ahead — or, before a fix or past the finish, the one thing to say. */
@Composable
private fun StopPage(navigation: Navigation, page: Int, expanded: Boolean, pickedM: Double?, onPick: (Double) -> Unit) {
    val route = navigation.route
    val progress = navigation.progress
    val names = remember(navigation.plan) { stopNames(navigation) }
    val first = progress?.nextStop

    if (progress == null) {
        val whole = remember(route) { route.terrain() }
        PageLine("WAITING FOR GPS…", names.getOrElse(1) { names.lastOrNull() ?: "" }, null)
        whole?.let { Profile(it, expanded, youM = null, marksM = emptyList(), pickedM = pickedM, onPick = onPick) }
        return
    }
    if (first == null) {
        PageLine(null, "⚑ ${names.lastOrNull() ?: ""}", "finish · you are there")
        return
    }

    val ordinal = first + page
    val reading = progress.ahead.getOrNull(page) ?: return
    val name = names.getOrElse(ordinal) { "" }
    val line = when {
        ordinal == route.stops.size - 1 -> "⚑ $name"
        page == 0 -> "→ $name"
        else -> "then $name"
    }
    // Measured again as you move, a stretch at a time: the profile always starts where you are.
    val stretch = remember(route, progress.alongM, ordinal) { route.terrainBetween(progress.alongM, route.stops[ordinal]) }
    val marks = remember(route, progress.alongM, ordinal) { (first until ordinal).map { route.stops[it] - progress.alongM } }

    PageLine(null, line, reading(reading))
    // You are where the stretch starts, always: no dot for it.
    stretch?.let { terrain ->
        Profile(terrain, expanded, youM = null, marksM = marks, pickedM = pickedM?.minus(progress.alongM)) { onPick(progress.alongM + it) }
    }
}

/** A page's one line: a label, a name and a note. */
@Composable
private fun PageLine(label: String?, name: String, note: String?) {
    Row(Modifier.fillMaxWidth().height(22.dp), verticalAlignment = Alignment.CenterVertically) {
        label?.let { BasicText(if (name.isEmpty()) it else "$it · ", style = Type.label, maxLines = 1) }
        BasicText(name, style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        note?.let { BasicText(" · $it", style = Type.mono, maxLines = 1) }
    }
}

/** The profile under a page's line: a strip collapsed, and the same drawing with room to read the climbs open. */
@Composable
private fun Profile(
    terrain: Terrain,
    expanded: Boolean,
    youM: Double?,
    marksM: List<Double>,
    pickedM: Double? = null,
    onPick: ((Double) -> Unit)? = null,
) {
    ElevationProfile(
        terrain,
        height = if (expanded) OPEN_PROFILE_HEIGHT else STRIP_HEIGHT,
        youM = youM,
        marksM = marksM,
        axes = false,
        minSpanM = PROFILE_MIN_SPAN_M,
        pickedM = pickedM,
        onPick = onPick,
    )
}

/** A ride with no plan: the profile of what has been ridden, you at its end. */
@Composable
private fun RideSoFar(elevation: Terrain?, expanded: Boolean) {
    PageLine("RIDE SO FAR", "", null)
    if (elevation == null) {
        BasicText("The profile starts once there is a climb or a descent to draw.", style = Type.note, maxLines = 2)
        return
    }
    Profile(elevation, expanded, youM = elevation.totalM, marksM = emptyList())
}

/** Speed, average speed, metres climbed and distance: the ride so far, whichever page is up. */
@Composable
private fun StatsRow(fix: Fix?, stats: RideStats, modifier: Modifier) {
    Column(modifier) {
        Box(Modifier.fillMaxWidth().padding(top = 4.dp).height(1.dp).background(Tokens.line))
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            val speed = fix?.speedMps?.takeUnless { stats.paused }?.let { (it * 3.6).roundToInt().toString() } ?: "—"
            Stat(speed, "km/h", Modifier.weight(1f))
            Stat(averageOf(stats), "avg km/h", Modifier.weight(1f))
            Stat(stats.climbedM?.let { Format.metres(it) } ?: "—", "m climbed", Modifier.weight(1f))
            Stat(Format.km(stats.distanceM), "km", Modifier.weight(1f))
        }
    }
}

/** The distance over the time spent moving, to a tenth; a dash until there has been a minute of it. */
private fun averageOf(stats: RideStats): String {
    if (stats.movingMillis < 60_000) return "—"
    val tenths = (stats.distanceM / (stats.movingMillis / 1000.0) * 36).roundToInt()
    return "${tenths / 10}.${tenths % 10}"
}

@Composable
private fun Stat(value: String, unit: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        BasicText(value, style = Type.number.copy(fontSize = 20.sp))
        BasicText(unit, style = Type.unit)
    }
}

@Composable
private fun Dots(pager: PagerState, modifier: Modifier = Modifier) {
    Row(modifier.padding(start = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(pager.pageCount) { page ->
            Box(Modifier.size(5.dp).background(if (page == pager.currentPage) Tokens.ink2 else Tokens.line2, CircleShape))
        }
    }
}

/** `2.4 km · ↑ 210 m`, with a `+` on each when a leg in between is not routed. */
private fun reading(reading: Reading): String {
    val plus = if (reading.incomplete) "+" else ""
    return "${Format.km(reading.distanceM)} km$plus · ↑ ${Format.metres(reading.ascentM)} m$plus"
}

/** Each stop's name by its ordinal: its own, or the finish or its place in the plan when nobody named it. */
private fun stopNames(navigation: Navigation): List<String> {
    val stops = navigation.plan.plan.waypoints.filter { it.kind == WaypointKind.Poi }
    return stops.mapIndexed { ordinal, stop ->
        stop.name ?: when (ordinal) {
            0 -> "Start"
            stops.size - 1 -> "Finish"
            else -> "Stop $ordinal"
        }
    }
}
