package net.stho.tracks.ui.riding

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
import net.stho.tracks.ui.plans.ElevationProfile
import net.stho.tracks.ui.plans.planDrawing
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** How close the riding map starts: about 1.7 km of road across a phone. Pinching changes it, and it keeps. */
const val RIDING_ZOOM = 15.0

/** The profiles on the panel: short, so a panel, the stats and the controls fit an SE2's 4.7″ with map to spare. */
private val PROFILE_HEIGHT = 52.dp

/** One page of the panel, fixed: a page change must not change what the map is inset by. */
private val PAGE_HEIGHT = 118.dp

/** The ride so far, as recorded: what the fixed row reads. */
data class RideStats(val paused: Boolean, val distanceM: Double, val climbedM: Double?)

/**
 * The screen you ride with: the map turned with you, and what is ahead of you on the plan you follow.
 *
 * - **The top card** is the next stop — its distance and climb from here — and swipes to the stops after it.
 * - **The bottom panel** swipes between *To finish* and *To next stop*, each with its profile and you on it. It is
 *   independent of the card: *To next stop* is always the actual next stop.
 * - **Under both, fixed**, the ride so far: speed, metres climbed, distance. Then Pause and Stop.
 *
 * A total across a leg that is not routed counts what is routed and says so with a `+`; the leg itself is its dash on
 * the map and a gap in the profile. There is no cue for being off the route: the map shows it.
 *
 * Without a [navigation] it is a ride with no plan: no card, and the panel is the profile of the ride so far,
 * [elevation]. Without [stats] — a ride stopped, or found interrupted — there is no panel at all, and [sheet] is what
 * asks about it.
 *
 * Your dot sits in the lower third of the map the card and the panel leave, heading-up, at [RIDING_ZOOM]; the compass
 * button turns it north-up and back. A tap on the map does nothing here.
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
    pulse: Boolean = true,
    onIdle: () -> Unit = {},
    sheet: @Composable BoxScope.() -> Unit = {},
) {
    var orientation by remember { mutableStateOf(Orientation.HeadingUp) }
    var cardBottom by remember { mutableStateOf<Dp?>(null) }
    var panelHeight by remember { mutableStateOf(0.dp) }
    val density = LocalDensity.current
    val stored = navigation?.plan
    val drawing = remember(stored, routing, pulse) { stored?.let { planDrawing(it, routing, pulse) } }
    val showCard = navigation != null && stats != null
    // What is not drawn covers nothing: the map is inset by what is on the screen.
    LaunchedEffect(showCard) { if (!showCard) cardBottom = null }
    LaunchedEffect(stats != null) { if (stats == null) panelHeight = 0.dp }

    BoxWithConstraints(modifier.fillMaxSize().background(Tokens.ground)) {
        val topInset = with(density) { WindowInsets.safeDrawing.getTop(this).toDp() }
        val top = cardBottom ?: (topInset + UNDER_MAP_CREDIT)
        val gap = (maxHeight - top - panelHeight).coerceAtLeast(0.dp)

        style?.let {
            TracksMap(
                style = it,
                // Centred in what the inset leaves: a top inset a third of the gap down puts you two thirds down it.
                camera = MapCamera.Follow(orientation, RIDING_ZOOM, PaddingValues(top = top + gap / 3, bottom = panelHeight)),
                modifier = Modifier.fillMaxSize(),
                ridden = ridden,
                fix = fix,
                heading = heading,
                drawing = drawing,
                onIdle = onIdle,
            )
        }

        Column(
            Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .padding(start = 8.dp, end = 8.dp, top = UNDER_MAP_CREDIT),
            horizontalAlignment = Alignment.End,
        ) {
            if (showCard && navigation != null) {
                StopCard(
                    navigation,
                    Modifier.fillMaxWidth().onGloballyPositioned { cardBottom = with(density) { it.boundsInRoot().bottom.toDp() } },
                )
            }
            IconButton(
                Icons.NorthUp,
                if (orientation == Orientation.HeadingUp) "North up" else "Heading up",
                onClick = { orientation = if (orientation == Orientation.HeadingUp) Orientation.NorthUp else Orientation.HeadingUp },
                modifier = Modifier.padding(top = 8.dp, end = 4.dp),
                primary = orientation == Orientation.NorthUp,
            )
        }

        if (stats != null) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .onSizeChanged { panelHeight = with(density) { it.height.toDp() } }
                    .background(Tokens.glassHi, Shapes.sheet)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                    .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
            ) {
                if (navigation != null) PlanPanel(navigation) else RideSoFar(elevation)
                StatsRow(fix, stats)
                Controls(stats.paused, onPause, onResume, onStop)
            }
        }

        sheet()
    }
}

/** The stop ahead and the ones after it, a page each; back to the next stop whenever it changes. */
@Composable
private fun StopCard(navigation: Navigation, modifier: Modifier) {
    val progress = navigation.progress
    val names = remember(navigation.plan) { stopNames(navigation) }
    val first = progress?.nextStop
    Column(
        modifier.background(Tokens.glassHi, Shapes.panel).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (progress == null || first == null) {
            BasicText(if (progress == null) "WAITING FOR A FIX" else "FINISH", style = Type.label)
            BasicText(if (progress == null) names.getOrElse(1) { "" } else "${names.last()} · you are there", style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
            return@Column
        }
        val ahead = progress.ahead
        key(first) {
            val pager = rememberPagerState { ahead.size }
            HorizontalPager(pager, Modifier.fillMaxWidth()) { page ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    BasicText(
                        "${if (page == 0) "NEXT STOP" else "THEN"} · ${page + 1} OF ${ahead.size}",
                        style = Type.label,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        BasicText(
                            names.getOrElse(first + page) { "" },
                            style = Type.body,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        ahead.getOrNull(page)?.let { BasicText(reading(it), style = Type.mono.copy(color = Tokens.ink2)) }
                    }
                }
            }
            if (ahead.size > 1) Dots(pager, Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

/** *To finish* and *To next stop*, a page each, of one fixed height. */
@Composable
private fun PlanPanel(navigation: Navigation) {
    val route = navigation.route
    val progress = navigation.progress
    val whole = remember(route) { route.terrain() }
    val nextStop = progress?.nextStop
    val nextLeg = nextStop?.let { it - 1 }
    val leg = remember(route, nextLeg) { nextLeg?.let(route::legTerrain) }
    val pager = rememberPagerState { 2 }

    Column {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            BasicText("TO FINISH", style = Type.label.copy(color = if (pager.currentPage == 0) Tokens.ink else Tokens.muted))
            BasicText("TO NEXT STOP", style = Type.label.copy(color = if (pager.currentPage == 1) Tokens.ink else Tokens.muted))
            Spacer(Modifier.weight(1f))
            Dots(pager)
        }
        HorizontalPager(pager, Modifier.fillMaxWidth().height(PAGE_HEIGHT)) { page ->
            Column {
                when {
                    progress == null -> Numbers(null)
                    page == 0 -> {
                        Numbers(progress.toFinish)
                        whole?.let { ElevationProfile(it, height = PROFILE_HEIGHT, youM = progress.alongM) }
                    }
                    nextStop == null || nextLeg == null -> BasicText("You are at the finish.", style = Type.note, modifier = Modifier.padding(top = 8.dp))
                    else -> {
                        Numbers(progress.ahead.firstOrNull())
                        leg?.let { ElevationProfile(it, height = PROFILE_HEIGHT, youM = progress.alongM - route.stops[nextLeg]) }
                    }
                }
            }
        }
    }
}

/** A ride with no plan: the profile of what has been ridden, you at its end. */
@Composable
private fun RideSoFar(elevation: Terrain?) {
    Column(Modifier.fillMaxWidth().height(PAGE_HEIGHT - 30.dp)) {
        BasicText("RIDE SO FAR", style = Type.label)
        if (elevation == null) {
            BasicText("The profile starts once there is a climb or a descent to draw.", style = Type.note, modifier = Modifier.padding(top = 8.dp))
        } else {
            ElevationProfile(elevation, height = PROFILE_HEIGHT, youM = elevation.totalM)
        }
    }
}

@Composable
private fun Numbers(reading: Reading?) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
        val plus = if (reading?.incomplete == true) "+" else ""
        Number(reading?.let { Format.km(it.distanceM) + plus } ?: "—", "km")
        Number(reading?.let { "↑ " + Format.metres(it.ascentM) + plus } ?: "—", "m")
    }
}

@Composable
private fun Number(value: String, unit: String) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        BasicText(value, style = Type.number)
        BasicText(unit, style = Type.unit, modifier = Modifier.padding(bottom = 3.dp))
    }
}

/** Speed, metres climbed and distance: the ride so far, whichever page is up. */
@Composable
private fun StatsRow(fix: Fix?, stats: RideStats) {
    Box(Modifier.fillMaxWidth().padding(top = 6.dp).height(1.dp).background(Tokens.line))
    Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
        val speed = fix?.speedMps?.takeUnless { stats.paused }?.let { (it * 3.6).roundToInt().toString() } ?: "—"
        Stat(speed, "km/h", Modifier.weight(1f))
        Stat(stats.climbedM?.let { Format.metres(it) } ?: "—", "m climbed", Modifier.weight(1f))
        Stat(Format.km(stats.distanceM), "km", Modifier.weight(1f))
    }
}

@Composable
private fun Stat(value: String, unit: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        BasicText(value, style = Type.number)
        BasicText(unit, style = Type.unit)
    }
}

@Composable
private fun Controls(paused: Boolean, onPause: () -> Unit, onResume: () -> Unit, onStop: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (paused) {
            Control("Resume", Tokens.accent, Tokens.surface, onResume, Modifier.weight(1f))
        } else {
            Control("Pause", Tokens.sunk, Tokens.ink, onPause, Modifier.weight(1f))
        }
        Control("Stop", Tokens.ink, Tokens.surface, onStop, Modifier.weight(1f))
    }
}

@Composable
private fun Control(label: String, background: Color, color: Color, onClick: () -> Unit, modifier: Modifier) {
    Box(
        modifier.height(44.dp).background(background, Shapes.control).clickable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        BasicText(label, style = Type.control.copy(color = color))
    }
}

@Composable
private fun Dots(pager: PagerState, modifier: Modifier = Modifier) {
    Row(modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
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
