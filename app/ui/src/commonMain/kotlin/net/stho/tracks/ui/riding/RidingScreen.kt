package net.stho.tracks.ui.riding

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation as DragOrientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Range
import net.stho.tracks.plan.cumulativeDistances
import net.stho.tracks.plan.sliceBetween
import net.stho.tracks.plan.poiIndices
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
import net.stho.tracks.ui.plans.ElevationProfile
import net.stho.tracks.ui.plans.StopList
import net.stho.tracks.ui.plans.planDrawing
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** How close the riding map follows you: about 1.7 km of road across a phone. Following always comes back to it. */
const val RIDING_ZOOM = 15.0

/**
 * A page open, fixed: a line, a profile with room to read the climbs, and the done/to-come row under it.
 *
 * Fixed because a page change must not move the map, and tall enough to hold all three — the axes and that row arrived
 * under the profile and the old height cut them off, which is a number you are riding by being drawn off the screen.
 */
private val OPEN_PAGE = 232.dp

private val OPEN_PROFILE_HEIGHT = 168.dp

/** What the large sheet leaves of the map: enough for the credit and the row of controls on it. */
private val MAP_STRIP = 104.dp

/**
 * How far the sheet opens, and what it holds — **each one adds below the one before**.
 *
 * Nothing moves as it grows, which is the whole of the idea: the figures you were reading stay where they were and
 * the sheet puts more under them. A ride starts [Small], because most of a ride is map.
 */
enum class Detent {
    /** One line: speed, average speed, the height you are at. No pages, so nothing to swipe. */
    Small,

    /** That line, and the profile of the leg you are on with its done/to-come row. */
    Medium,

    /** Both, and the stops — searchable, reorderable, deletable — over a strip of map. */
    Large,
    ;

    val open: Boolean get() = this != Small

    /** The next one up; the largest wraps back to the smallest, so one gesture reaches all three. */
    fun up(): Detent = when (this) {
        Small -> Medium
        Medium -> Large
        Large -> Small
    }

    fun down(): Detent = when (this) {
        Small -> Small
        Medium -> Small
        Large -> Medium
    }
}

/**
 * The plan you are riding, as the large sheet edits it.
 *
 * Every change goes back through the ride's own undo stack, which is why this is a handful of callbacks rather than an
 * editor of its own: there is one plan, one place it is saved, and one stack that takes an edit back.
 */
class RidePlanEditing(
    val plan: Plan,
    val legs: List<Leg?>,
    val onRemove: (Int) -> Unit,
    val onMoveStop: (from: Int, to: Int) -> Unit,
    /** The place search, which belongs to whoever owns the geocoder. Absent in the screenshots. */
    val search: (@Composable () -> Unit)? = null,
)

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
 * - **Pause and Stop** are buttons under the profile in the large sheet, centred, and nowhere else: both are
 *   deliberate acts, and a menu over a map is a tap between a rider and the thing they meant. While paused, a chip
 *   over the map says so, and resumes.
 *
 * The sheet opens to one of three [Detent]s, each adding below the one before: the figures, then the pages, then the
 * stops. A drag or a tap on its top moves between them, and [onDetent] is told.
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
 *
 * [heading] is read, not handed over: the compass is for the map alone, and it fires up to ~30 times a second while the
 * phone moves. Passed as a value it recomposed this whole screen on every one — the sheet, the figures, the profile,
 * none of which read it — which was a third of what the compass cost (app/docs/battery/REPORT.md).
 */
@Composable
fun RidingScreen(
    style: MapStyle?,
    fix: Fix?,
    heading: () -> Heading?,
    ridden: List<Coordinate>,
    navigation: Navigation?,
    routing: PlanRouting?,
    elevation: Terrain?,
    stats: RideStats?,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    detent: Detent = Detent.Small,
    onDetent: (Detent) -> Unit = {},
    onLongPlace: ((Coordinate, String?) -> Unit)? = null,
    /** A tap on a waypoint of the plan you are riding: its dialog, to delete it or change what it is. */
    onWaypointTap: ((Int) -> Unit)? = null,
    /** The plan you are riding, as the large sheet edits it. */
    editing: RidePlanEditing? = null,
    undo: UndoControls? = null,
    pulse: Boolean = true,
    /** A place on the route picked as the screen appears, in metres along it: for the screenshots. */
    initiallyPickedM: Double? = null,
    /** A stretch already selected on the leg page, in metres along that page: for the screenshots. */
    initialRange: Range? = null,
    onIdle: () -> Unit = {},
    sheet: @Composable BoxScope.() -> Unit = {},
) {
    var orientation by remember { mutableStateOf(Orientation.HeadingUp) }
    var manual by remember { mutableStateOf(initiallyPickedM != null) }
    // Metres along the route, not along a page: it stays put as you ride, whichever page shows it.
    var pickedM by remember { mutableStateOf(initiallyPickedM) }
    /** The stretch two bars enclose, in metres along the *route*, whichever page it was swept on. */
    var selected by remember { mutableStateOf<Range?>(null) }
    /** The same, on the ride itself: a stretch swept on the ridden-so-far page, in metres ridden. */
    var selectedRidden by remember { mutableStateOf<Range?>(null) }

    val highlighted = remember(navigation?.route, selected) {
        val range = selected
        val route = navigation?.route
        if (range == null || route == null) emptyList() else route.lineBetween(range.fromM, range.toM)
    }
    /**
     * The ridden stretch, measured the way the ridden profile is.
     *
     * Its distances are the odometer's — counted only while moving, and recorded no oftener than every few metres —
     * so they index neither the drawn track nor a naive sum along it. Scaling the track's own cumulative distance to
     * the ride's counted length is the same trick `profileOf` uses for an activity, and lands each metre within a
     * pace of where the profile put it.
     */
    val riddenHighlight = remember(ridden, elevation?.totalM, selectedRidden) {
        val range = selectedRidden
        val totalM = elevation?.totalM
        if (range == null || totalM == null || ridden.size < 2) {
            emptyList()
        } else {
            sliceBetween(ridden, cumulativeDistances(ridden, totalM), range.fromM, range.toM)
        }
    }
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
                onWaypointTap = { onWaypointTap?.invoke(it) },
                highlight = highlighted.ifEmpty { riddenHighlight },
                highlightRidden = highlighted.isEmpty() && riddenHighlight.isNotEmpty(),
                onGesture = { manual = true },
                marker = picked,
                onIdle = onIdle,
            )
        }

        // On the map, just above the sheet, and they ride up with it: the hand that reaches them is already down
        // there, and a control at the top of the screen is a stretch on a handlebar. At the large detent they sit on
        // the strip of map it leaves rather than going away.
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(bottom = sheetHeight + 6.dp)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (stats?.paused == true) PausedChip(onResume)
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Each in a slot of its own, so neither moves as the other comes and goes.
                Box(Modifier.size(44.dp)) { if (undo?.canUndo == true) IconButton(Icons.Undo, "Undo", undo.onUndo, tint = Tokens.bad) }
                Box(Modifier.size(44.dp)) { if (undo?.canRedo == true) IconButton(Icons.Redo, "Redo", undo.onRedo, tint = Tokens.accent) }
                Box(Modifier.weight(1f))
                // Two glyphs, three states, and **the button always shows the mode the map is in or would go
                // into** — so a tap never changes the shape under your thumb, only its colour. Manual draws the
                // mode it would resume in black; following draws the mode it is in, in green.
                when {
                    manual -> IconButton(
                        if (orientation == Orientation.HeadingUp) Icons.HeadingUp else Icons.Compass,
                        if (orientation == Orientation.HeadingUp) "Follow me again, heading up" else "Follow me again, north up",
                        onClick = { manual = false },
                    )
                    orientation == Orientation.HeadingUp ->
                        IconButton(Icons.HeadingUp, "Heading up; turn north up", onClick = { orientation = Orientation.NorthUp }, tint = Tokens.accent)
                    else -> IconButton(Icons.Compass, "North up; turn heading up", onClick = { orientation = Orientation.HeadingUp }, tint = Tokens.accent)
                }
            }
        }

        if (stats != null) {
            RideSheet(
                navigation = navigation,
                elevation = elevation,
                fix = fix,
                stats = stats,
                detent = detent,
                onDetent = onDetent,
                onPause = onPause,
                onResume = onResume,
                onStop = onStop,
                pickedM = pickedM,
                onPick = { alongM ->
                    pickedM = alongM
                    manual = true
                },
                onRange = { selected = it },
                onRiddenRange = { selectedRidden = it },
                initialRange = initialRange,
                editing = editing,
                maxHeight = maxHeight - MAP_STRIP,
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

/**
 * The one sheet, at whichever [Detent] it is open to.
 *
 * Each detent adds below the one before: the figures are the top of all three, the pages come under them from
 * [Detent.Medium], and the stops come under those at [Detent.Large]. Nothing already on the screen moves as it grows,
 * so the number you were reading is where you left it.
 *
 * The pages are **what you have ridden**, then a page per stop still ahead, then **the whole trip** — the two questions
 * a swipe is for, with the legs between them. [Detent.Small] has no pages and so nothing to swipe.
 */
@Composable
private fun RideSheet(
    navigation: Navigation?,
    elevation: Terrain?,
    fix: Fix?,
    stats: RideStats,
    detent: Detent,
    onDetent: (Detent) -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    pickedM: Double?,
    onPick: (Double) -> Unit,
    onRange: (Range?) -> Unit,
    onRiddenRange: (Range?) -> Unit,
    initialRange: Range?,
    editing: RidePlanEditing?,
    maxHeight: Dp,
    modifier: Modifier,
) {
    val snap = with(LocalDensity.current) { SNAP_DRAG.toPx() }
    var dragged by remember { mutableFloatStateOf(0f) }
    val progress = navigation?.progress
    val first = progress?.nextStop
    val ahead = if (navigation != null && progress != null && first != null) progress.ahead.size else 0
    // What is done, every stop still ahead, and the whole trip. Without a plan there is only what is done.
    val pages = if (navigation == null) 1 else ahead + 2
    val scope = rememberCoroutineScope()

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
                        dragged < -snap || velocity < -800f -> onDetent(detent.up())
                        dragged > snap || velocity > 800f -> onDetent(detent.down())
                    }
                },
            )
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .then(if (detent == Detent.Large) Modifier.height(maxHeight) else Modifier.animateContentSize())
            .padding(start = 14.dp, end = 6.dp, bottom = 10.dp),
    ) {
        // Back to the leg you are on whenever the next stop changes, or the plan does: page 0 is behind you.
        key(navigation?.plan?.id, first) {
            val pager = rememberPagerState(initialPage = if (navigation == null) 0 else 1) { pages }

            Box(
                Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onDetent(detent.up()) }
                    .semantics { contentDescription = if (detent == Detent.Large) "Close" else "Open further" },
            ) {
                Box(Modifier.align(Alignment.Center).width(36.dp).height(5.dp).background(Tokens.line2, Shapes.pill))
                if (detent.open && pages > 1) Dots(pager, Modifier.align(Alignment.CenterStart))
            }

            StatsRow(fix, stats, Modifier.padding(end = 8.dp))

            if (detent.open) {
                HorizontalPager(pager, Modifier.fillMaxWidth().padding(end = 8.dp).height(OPEN_PAGE)) { page ->
                    Column(Modifier.fillMaxSize()) {
                        when {
                            // The ridden profile is measured along the *ride*, not along the route, so a stretch on
                            // it highlights the line that was actually ridden rather than the plan beside it.
                            navigation == null -> RideSoFar(elevation, pickedM, onPick, onRiddenRange)
                            page == 0 -> RideSoFar(elevation, pickedM, onPick, onRiddenRange)
                            page == pages - 1 -> WholeTrip(navigation, pickedM, onPick, onRange)
                            else -> StopPage(navigation, page - 1, pickedM, onPick, onRange, initialRange)
                        }
                    }
                }
            }

            // Pausing and stopping a ride, under the profile rather than in the header: **opening the sheet only
            // ever adds below what was already there**, which is the whole of how the detents work, and a control
            // that appears at the top moves the one thing you were reading. There is no ⋯ any more — a menu over a
            // map is a tap between a rider and the thing they meant, and both of these are deliberate acts.
            if (detent == Detent.Large) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp, end = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (stats.paused) {
                        IconButton(Icons.Resume, "Resume", onResume, tint = Tokens.accent)
                    } else {
                        IconButton(Icons.Pause, "Pause", onPause)
                    }
                    IconButton(Icons.StopRide, "Stop", onStop, tint = Tokens.accent)
                }
            }

            if (detent == Detent.Large && editing != null) {
                Box(Modifier.fillMaxWidth().padding(top = 6.dp, end = 8.dp).height(1.dp).background(Tokens.line))
                Stops(
                    editing = editing,
                    // A tap on a stop is a question about that leg, so the pages answer it: the leg ending there.
                    onSwipeTo = { ordinal ->
                        val page = if (first == null) pages - 1 else (ordinal - first + 1).coerceIn(0, pages - 1)
                        scope.launch { pager.animateScrollToPage(page) }
                    },
                    modifier = Modifier.fillMaxWidth().weight(1f).padding(end = 8.dp),
                )
            }
        }
    }
}

/**
 * The stops, over the strip of map the large sheet leaves: searchable, reorderable, deletable.
 *
 * It is the editor's own list, not a second one — every edit goes through the ride's undo stack, so a stop dropped in
 * the wrong place on a handlebar is one tap from being back where it was.
 */
@Composable
private fun Stops(editing: RidePlanEditing, onSwipeTo: (Int) -> Unit, modifier: Modifier) {
    var base by remember { mutableStateOf(0) }
    Column(modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        editing.search?.invoke()
        if (editing.plan.waypoints.isEmpty()) {
            BasicText("No stops yet. Long-press the map to add one, or search for a place.", style = Type.note)
        } else {
            StopList(
                plan = editing.plan,
                legs = editing.legs,
                base = base,
                onBase = { base = it },
                onEdit = { index ->
                    base = index
                    onSwipeTo(poiIndices(editing.plan.waypoints).indexOf(index).coerceAtLeast(0))
                },
                onRemove = editing.onRemove,
                onMoveStop = editing.onMoveStop,
            )
        }
    }
}

/**
 * The leg [leg] stops ahead: **stop to stop**, with a bar where you are on it.
 *
 * You are on the first of them, so it is drawn from the stop behind you to the one in front — the climb you are half
 * way up is a climb, not the end of one. Every leg after that starts at a stop you have not reached, so it is
 * **extended back to you**: a profile of a stretch you are not on yet has nowhere to put the bar otherwise.
 */
@Composable
private fun StopPage(
    navigation: Navigation,
    leg: Int,
    pickedM: Double?,
    onPick: (Double) -> Unit,
    onRange: (Range?) -> Unit,
    initialRange: Range? = null,
) {
    val route = navigation.route
    val progress = navigation.progress
    val names = remember(navigation.plan) { stopNames(navigation) }
    val first = progress?.nextStop

    if (progress == null) {
        val whole = remember(route) { route.terrain() }
        PageLine("WAITING FOR GPS…", names.getOrElse(1) { names.lastOrNull() ?: "" }, null)
        whole?.let { Profile(it, youM = null, marksM = emptyList(), pickedM = pickedM, onPick = onPick, onRange = onRange) }
        return
    }
    if (first == null) {
        PageLine(null, "⚑ ${names.lastOrNull() ?: ""}", "finish · you are there")
        return
    }

    val ordinal = first + leg
    val reading = progress.ahead.getOrNull(leg) ?: return
    val name = names.getOrElse(ordinal) { "" }
    val line = when {
        ordinal == route.stops.size - 1 -> "⚑ $name"
        leg == 0 -> "→ $name"
        else -> "then $name"
    }

    // The leg you are on starts at the stop behind you; one further ahead starts where you are, because its own start
    // is still to come and a bar has to be somewhere.
    val behind = if (leg == 0 && first > 0) route.stops[first - 1] else null
    val fromM = behind ?: progress.alongM
    val stretch = remember(route, fromM, ordinal) { route.terrainBetween(fromM, route.stops[ordinal]) }
    val marks = remember(route, fromM, ordinal) { (first until ordinal).map { route.stops[it] - fromM } }

    PageLine(null, line, reading(reading))
    stretch?.let { terrain ->
        Profile(
            terrain,
            youM = behind?.let { progress.alongM - it },
            marksM = marks,
            pickedM = pickedM?.minus(fromM),
            onPick = { onPick(fromM + it) },
            // A page is measured from where it starts; the route is not, so the stretch is moved onto it.
            onRange = { onRange(it?.let { range -> Range(fromM + range.fromM, fromM + range.toM) }) },
            initialRange = initialRange.takeIf { leg == 0 },
        )
    }
}

/** The last page: the trip end to end, with you somewhere on it. */
@Composable
private fun WholeTrip(navigation: Navigation, pickedM: Double?, onPick: (Double) -> Unit, onRange: (Range?) -> Unit) {
    val route = navigation.route
    val whole = remember(route) { route.terrain() } ?: return
    val names = remember(navigation.plan) { stopNames(navigation) }
    val marks = remember(route) { route.stops.drop(1).dropLast(1) }

    PageLine("WHOLE TRIP", names.lastOrNull() ?: "", null)
    Profile(whole, youM = navigation.progress?.alongM, marksM = marks, pickedM = pickedM, onPick = onPick, onRange = onRange)
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

/** The profile under a page's line, with room to read the climbs. */
@Composable
private fun Profile(
    terrain: Terrain,
    youM: Double?,
    marksM: List<Double>,
    pickedM: Double? = null,
    onPick: ((Double) -> Unit)? = null,
    onRange: ((Range?) -> Unit)? = null,
    initialRange: Range? = null,
) {
    ElevationProfile(
        terrain,
        height = OPEN_PROFILE_HEIGHT,
        youM = youM,
        marksM = marksM,
        // A page is only ever drawn open now, so it is always a chart: gridlines, round labels and the
        // done/to-come row under it.
        axes = true,
        minSpanM = PROFILE_MIN_SPAN_M,
        pickedM = pickedM,
        onPick = onPick,
        onRange = onRange,
        initialRange = initialRange,
    )
}

/** A ride with no plan: the profile of what has been ridden, you at its end. */
@Composable
private fun RideSoFar(elevation: Terrain?, pickedM: Double?, onPick: (Double) -> Unit, onRange: (Range?) -> Unit) {
    PageLine("RIDDEN SO FAR", "", null)
    if (elevation == null) {
        BasicText("The profile starts once there is a climb or a descent to draw.", style = Type.note, maxLines = 2)
        return
    }
    // Measured from the ride's own start, which is where this profile starts too.
    Profile(elevation, youM = elevation.totalM, marksM = emptyList(), pickedM = pickedM, onPick = onPick, onRange = onRange)
}

/**
 * Speed, average speed, and the height you are at: the whole of the small sheet, and the top of the other two.
 *
 * Distance and climb left this line when the profile arrived under it — its done/to-come row carries both, measured
 * from where you are, which is what those two numbers were being read for. Height took the space, because a profile
 * says how much climbing is left and nothing else says how high you are now.
 */
@Composable
private fun StatsRow(fix: Fix?, stats: RideStats, modifier: Modifier) {
    Row(modifier.fillMaxWidth().padding(top = 2.dp, bottom = 2.dp)) {
        val speed = fix?.speedMps?.takeUnless { stats.paused }?.let { (it * 3.6).roundToInt().toString() } ?: "—"
        Stat(speed, "km/h", Modifier.weight(1f))
        Stat(averageOf(stats), "avg km/h", Modifier.weight(1f))
        Stat(fix?.altitudeM?.let { Format.metres(it) } ?: "—", "m", Modifier.weight(1f))
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
