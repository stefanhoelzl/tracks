package net.stho.tracks.ui.plans

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlin.math.abs
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.readingsFrom
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import net.stho.tracks.plan.poiIndices
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/**
 * The stops, as the web's WaypointPanel lists them: a row per stop, and the shaping points inside a leg as ticks on
 * the way to the next one — so fifteen hints and two real places read as the trip they are.
 *
 * Each row carries the distance and the climb to it, measured from the row that is selected: *how far is the hut from
 * here*. With nothing selected they are measured from the start. A tap selects a row, and a tap on the selected row
 * edits it; its ×, where there is one, removes it; a long press picks a stop up to move it, and the stops it passes make
 * room where it will land.
 */
@Composable
fun StopList(
    plan: Plan,
    legs: List<Leg?>,
    base: Int,
    onBase: (Int) -> Unit,
    onEdit: (Int) -> Unit,
    /**
     * Removes a waypoint from its row's ×. Null for no × at all: the editor's rows have none, and Remove is in the stop's
     * dialog, as on the web; the riding sheet keeps it, since tapping a row there turns the pages rather than opening
     * a dialog.
     */
    onRemove: ((Int) -> Unit)?,
    onMoveStop: (from: Int, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    carried: StopDrag? = null,
) {
    val readings = readingsFrom(legs, base)
    var drag by remember(carried) { mutableStateOf(carried) }
    // Where each stop's row starts in the list, by ordinal, as laid out: what a carried stop is dropped against.
    val tops = remember { mutableStateMapOf<Int, Float>() }
    var listHeight by remember { mutableFloatStateOf(0f) }

    /** A stop and the shaping points leading out of it, which move as one. */
    fun blockHeight(ordinal: Int): Float {
        val top = tops[ordinal] ?: return 0f
        return (tops[ordinal + 1] ?: listHeight) - top
    }

    fun target(carry: StopDrag): Int {
        val top = tops[carry.stop] ?: return carry.stop
        val centre = top + blockHeight(carry.stop) / 2 + carry.offsetPx
        return tops.keys.minByOrNull { abs((tops[it] ?: 0f) + blockHeight(it) / 2 - centre) } ?: carry.stop
    }

    /** How far a block moves while another is carried: out of the way of where the carried one will land. */
    fun shift(ordinal: Int): Float {
        val carry = drag ?: return 0f
        if (ordinal == carry.stop) return carry.offsetPx
        val to = target(carry)
        val room = blockHeight(carry.stop)
        return when {
            to > carry.stop && ordinal in carry.stop + 1..to -> -room
            to < carry.stop && ordinal in to until carry.stop -> room
            else -> 0f
        }
    }

    val lastStop = poiIndices(plan.waypoints).size - 1

    Column(modifier.onSizeChanged { listHeight = it.height.toFloat() }) {
        var stop = -1
        plan.waypoints.forEachIndexed { index, waypoint ->
            if (waypoint.kind == WaypointKind.Poi) stop += 1
            val ordinal = stop
            val lifted = drag?.stop == ordinal && ordinal >= 0
            // The carried stop follows the finger; the others ease aside.
            val moved = if (lifted) shift(ordinal) else animateFloatAsState(shift(ordinal), label = "stop $ordinal").value
            val placement = Modifier
                .zIndex(if (lifted) 1f else 0f)
                .graphicsLayer { translationY = if (ordinal >= 0) moved else 0f }

            if (waypoint.kind == WaypointKind.Poi) {
                val reading = readings.getOrNull(ordinal)
                Row(
                    // Measured outside the translation: where the row rests, not where it is drawn while stops move,
                    // or the list would chase its own animation.
                    Modifier
                        .onGloballyPositioned { tops[ordinal] = it.positionInParent().y }
                        .then(placement)
                        .graphicsLayer { shadowElevation = if (lifted) 8.dp.toPx() else 0f }
                        // A long press picks a stop up — a plain drag scrolls the sheet.
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
                        .background(
                            when {
                                lifted -> Tokens.surface
                                ordinal == base -> Tokens.accentSoft
                                else -> Tokens.surface
                            },
                            Shapes.control,
                        )
                        .clickable { if (ordinal == base) onEdit(index) else onBase(ordinal) }
                        .padding(start = 12.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // The mark says which end of the line this is, in the four the dialog offers.
                    Image(
                        when (ordinal) {
                            0 -> Icons.Start
                            lastStop -> Icons.End
                            else -> Icons.Mid
                        },
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        colorFilter = ColorFilter.tint(Tokens.accent),
                    )
                    BasicText(
                        waypoint.name ?: "Unnamed stop",
                        style = Type.body,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    // The row measured from carries no numbers; a gap that did not route is a dash, not a guess.
                    if (reading != null && drag == null) {
                        BasicText(
                            if (reading.incomplete) "—" else "${Format.km(reading.distanceM)} km · ${Format.metres(reading.ascentM)} m up",
                            style = Type.mono,
                        )
                    }
                    onRemove?.let { remove -> Remove { remove(index) } }
                }
            } else {
                Row(
                    placement.fillMaxWidth().padding(start = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Image(
                        Icons.Shaping,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        colorFilter = ColorFilter.tint(Tokens.ink),
                    )
                    BasicText(
                        "Shaping point",
                        style = Type.mono,
                        modifier = Modifier.weight(1f).clickable { onEdit(index) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                    onRemove?.let { remove -> Remove { remove(index) } }
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
