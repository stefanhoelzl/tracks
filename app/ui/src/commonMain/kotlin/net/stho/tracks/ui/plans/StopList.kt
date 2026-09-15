package net.stho.tracks.ui.plans

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.zIndex
import kotlin.math.abs
import kotlin.math.roundToInt
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.readingsFrom
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/**
 * The stops, as the web's WaypointPanel lists them: a row per stop, and the shaping points inside a leg as ticks on
 * the way to the next one — so fifteen hints and two real places read as the trip they are.
 *
 * Each row carries the distance and the climb to it, measured from the row that is selected: *how far is the hut from
 * here*. With nothing selected they are measured from the start. A tap selects a row; its × removes it; a long press
 * picks a stop up to move it.
 */
@Composable
fun StopList(
    plan: Plan,
    legs: List<Leg?>,
    base: Int,
    onBase: (Int) -> Unit,
    onEdit: (Int) -> Unit,
    onRemove: (Int) -> Unit,
    onMoveStop: (from: Int, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    carried: StopDrag? = null,
) {
    val readings = readingsFrom(legs, base)
    var stop = -1
    var drag by remember(carried) { mutableStateOf(carried) }
    // Where each stop's row sits in the list, by ordinal: what a carried row is dropped against.
    val rows = remember { mutableStateMapOf<Int, Pair<Float, Float>>() }

    fun target(carry: StopDrag): Int {
        val (top, height) = rows[carry.stop] ?: return carry.stop
        val centre = top + height / 2 + carry.offsetPx
        return rows.minByOrNull { (_, row) -> abs(row.first + row.second / 2 - centre) }?.key ?: carry.stop
    }

    var listHeight by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current

    Box(modifier) {
    Column(Modifier.fillMaxWidth().onSizeChanged { listHeight = it.height.toFloat() }) {
        plan.waypoints.forEachIndexed { index, waypoint ->
            if (waypoint.kind == WaypointKind.Poi) {
                stop += 1
                val ordinal = stop
                val reading = readings.getOrNull(ordinal)
                val lifted = drag?.stop == ordinal
                Row(
                    Modifier
                        .onGloballyPositioned { rows[ordinal] = it.positionInParent().y to it.size.height.toFloat() }
                        .zIndex(if (lifted) 1f else 0f)
                        .graphicsLayer {
                            translationY = if (lifted) drag?.offsetPx ?: 0f else 0f
                            shadowElevation = if (lifted) 8.dp.toPx() else 0f
                        }
                        // A long press picks a stop up — a plain drag scrolls the sheet — and it carries the
                        // shaping points leading out of it, as on the web.
                        .pointerInput(ordinal, plan) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { drag = StopDrag(ordinal, 0f) },
                                onDrag = { change, amount ->
                                    change.consume()
                                    drag = drag?.let { it.copy(offsetPx = it.offsetPx + amount.y) }
                                },
                                onDragEnd = {
                                    drag?.let { carry ->
                                        val to = target(carry)
                                        drag = null
                                        if (to != carry.stop) onMoveStop(carry.stop, to)
                                    }
                                },
                                onDragCancel = { drag = null },
                            )
                        }
                        .fillMaxWidth()
                        .background(if (ordinal == base) Tokens.accentSoft else Tokens.surface, Shapes.control)
                        .clickable { if (ordinal == base) onEdit(index) else onBase(ordinal) }
                        .padding(start = 12.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(Modifier.size(10.dp).background(Tokens.accent, CircleShape))
                    BasicText(
                        waypoint.name ?: "Unnamed stop",
                        style = Type.body,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    // The row measured from carries no numbers; a gap that did not route is a dash, not a guess.
                    if (reading != null) {
                        BasicText(
                            if (reading.incomplete) "—" else "${Format.km(reading.distanceM)} km · ${Format.metres(reading.ascentM)} m up",
                            style = Type.mono,
                        )
                    }
                    Remove { onRemove(index) }
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(start = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(2.dp).padding(vertical = 2.dp).background(Tokens.line2))
                    BasicText(
                        "Shaping point",
                        style = Type.mono,
                        modifier = Modifier.weight(1f).clickable { onEdit(index) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                    Remove { onRemove(index) }
                }
            }
        }
    }

    // Where the carried stop lands: above the stop it is moved before, or below the block of the stop it is moved after.
    drag?.let { carry ->
        val to = target(carry)
        if (to != carry.stop) {
            val y = if (to < carry.stop) rows[to]?.first else rows[to + 1]?.first ?: listHeight
            if (y != null) {
                val half = with(density) { 1.5.dp.toPx() }
                Box(
                    Modifier
                        .offset { IntOffset(0, (y - half).roundToInt()) }
                        .zIndex(2f)
                        .fillMaxWidth()
                        .height(3.dp)
                        .background(Tokens.accent, Shapes.pill),
                )
            }
        }
    }
    }
}

/** A stop being carried in the list: its ordinal, and how far it has moved from its row, in pixels. */
data class StopDrag(val stop: Int, val offsetPx: Float)

@Composable
private fun Remove(onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        BasicText("×", style = Type.body.copy(color = Tokens.muted))
    }
}

/** The five profiles, as pills: which way the whole plan is routed. */
@Composable
fun ProfilePills(selected: Profile, onSelect: (Profile) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (profile in Profile.entries) {
            val on = profile == selected
            BasicText(
                profile.label,
                style = Type.body.copy(color = if (on) Tokens.surface else Tokens.ink2),
                modifier = Modifier
                    .background(if (on) Tokens.accent else Tokens.sunk, Shapes.pill)
                    .clickable { onSelect(profile) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}
