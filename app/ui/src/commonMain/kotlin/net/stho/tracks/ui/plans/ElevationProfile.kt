package net.stho.tracks.ui.plans

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Range
import net.stho.tracks.plan.Terrain
import net.stho.tracks.plan.alongAt
import net.stho.tracks.plan.altitudeAt
import net.stho.tracks.plan.distanceAxis
import net.stho.tracks.plan.heightAxis
import net.stho.tracks.plan.splitAt
import net.stho.tracks.plan.statsBetween
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** The area under the line, against the line's own colour at full strength. */
private const val AREA_OPACITY = 0.16f

/** What the line drops to outside a selected stretch. The stretch keeps its own colour. */
private const val OUTSIDE_OPACITY = 0.28f

/** How near one of a stretch's bars a long press has to land to pick that bar up rather than start a new one. */
private val EDGE_REACH = 24.dp

/** A swept stretch narrower than this share of the track is a press that went nowhere, and makes no stretch. */
private const val SLIVER = 0.01

/** What a long press picked up: the end that stays put while the finger moves the other. */
private data class Grab(val anchorM: Double)

/** Room for the height labels on the left, and for the distance labels underneath. */
private val AXIS_GUTTER = 38.dp
private val AXIS_FOOT = 16.dp

/**
 * A track's terrain against distance, drawn as the web's `ElevationProfile` draws it — the same axes, the same figures
 * and the same numbers, over the same arithmetic in `plan/Profile.kt`.
 *
 * **One gesture makes a stretch, and it is the one that claims the screen.** A profile here sits inside a horizontal
 * pager inside a sheet you drag open, and both of those want a drag — so a **long press** is what takes it from them.
 * A tap puts the bar down or moves it. A long press and a drag **sweeps out a stretch**, which is the web's click-drag
 * said the phone's way; a long press on either of its bars and a drag **moves that end**. A tap clears it.
 *
 * A double tap used to open a stretch and the next tap used to close it, and both ends were then fixed. It fired by
 * accident — tapping twice to move the bar *is* a double tap — and left something on the screen that could not be
 * adjusted, only cleared. A long press is never made by mistake, and the thing that selects is now the thing that
 * already claimed the gesture.
 *
 * [youM] is where you are along it, a dashed rule with a dot on the line: while something is riding this stretch the
 * flanking figures are measured from *you*, and a bar you put down only reports itself. [marksM] are stops along it,
 * each a faint dashed rule. Without [axes] it is the line alone, edge to edge: a strip under a line of text, with no
 * gridlines and no figures.
 */
@Composable
fun ElevationProfile(
    terrain: Terrain,
    modifier: Modifier = Modifier,
    height: Dp = 96.dp,
    youM: Double? = null,
    marksM: List<Double> = emptyList(),
    axes: Boolean = true,
    minSpanM: Double = Terrain.MIN_SPAN_M,
    pickedM: Double? = null,
    onPick: ((Double) -> Unit)? = null,
    /** Told which stretch is selected, so the map can dim the rest of the track. */
    onRange: ((Range?) -> Unit)? = null,
    /** A stretch already selected as the profile appears, in metres along it: for the screenshots. */
    initialRange: Range? = null,
) {
    val stops = remember(terrain) { terrain.rampStops() }
    val scale = remember(terrain, minSpanM) {
        val measured = terrain.altitudeM.filterNotNull()
        heightAxis(measured.min(), measured.max(), minSpanM)
    }
    val along = remember(terrain) { distanceAxis(terrain.totalM) }
    val measurer = rememberTextMeasurer()

    var range by remember { mutableStateOf(initialRange) }
    /** What the long press picked up, for as long as the finger is down. */
    var grab by remember { mutableStateOf<Grab?>(null) }
    val currentOnPick by rememberUpdatedState(onPick)
    val currentOnRange by rememberUpdatedState(onRange)
    // Read live rather than keyed on: see below.
    val currentTerrain by rememberUpdatedState(terrain)

    // A stretch the caller handed over is reported once, so whatever draws it on the map hears about it too.
    LaunchedEffect(Unit) { initialRange?.let { currentOnRange?.invoke(it) } }

    // A ride's profile is a new `Terrain` every fix — it grows as you go — and a selection keyed on it was swept away
    // every second or so, which is what "the selection resets from time to time" was. It is in metres along the track,
    // so it stays meaningful while the track grows; it is only touched when the track gets *shorter* than it.
    LaunchedEffect(terrain.totalM) {
        val held = range ?: return@LaunchedEffect
        val clamped = Range(held.fromM.coerceIn(0.0, terrain.totalM), held.toM.coerceIn(0.0, terrain.totalM))
        when {
            clamped.toM - clamped.fromM < terrain.totalM * SLIVER -> {
                range = null
                currentOnRange?.invoke(null)
            }
            clamped != held -> {
                range = clamped
                currentOnRange?.invoke(clamped)
            }
        }
    }

    val picking = if (onPick == null && onRange == null) {
        Modifier
    } else {
        // The long press comes first in the chain: it is what claims the drag from the pager and the sheet around
        // this, and a tap never reaches it because a tap is not a long press.
        //
        // **Keyed on nothing, and the terrain read live.** A ride's profile is a new `Terrain` every fix — it grows as
        // you go — and `pointerInput(terrain)` cancels and restarts its coroutine whenever the key changes, which
        // killed a scrub a second or two in, under the finger. The gesture outlives the shape it is measuring.
        Modifier
            .pointerInput(Unit) {
                val reach = EDGE_REACH.toPx()
                fun at(x: Float) = alongAt(currentTerrain.totalM, (x / size.width).toDouble())
                fun px(alongM: Double) = (alongM / currentTerrain.totalM * size.width).toFloat()

                detectDragGesturesAfterLongPress(
                    onDragStart = { press ->
                        val current = range
                        val fromEdge = current?.let { abs(press.x - px(it.fromM)) }
                        val toEdge = current?.let { abs(press.x - px(it.toM)) }
                        grab = if (current != null && fromEdge != null && toEdge != null && minOf(fromEdge, toEdge) < reach) {
                            // Held by one end: the other stays where it is and this one follows the finger.
                            Grab(if (fromEdge <= toEdge) current.toM else current.fromM)
                        } else {
                            currentOnPick?.invoke(at(press.x))
                            Grab(at(press.x))
                        }
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        grab?.let { held ->
                            val here = at(change.position.x)
                            val next = Range(minOf(held.anchorM, here), maxOf(held.anchorM, here))
                            range = next
                            currentOnRange?.invoke(next)
                        }
                    },
                    onDragEnd = {
                        // A sweep that went nowhere was a long press, not a stretch.
                        range?.takeIf { it.toM - it.fromM < currentTerrain.totalM * SLIVER }?.let {
                            range = null
                            currentOnRange?.invoke(null)
                        }
                        grab = null
                    },
                    onDragCancel = { grab = null },
                )
            }
            .pointerInput(Unit) {
                detectTapGestures { tap ->
                    val at = alongAt(currentTerrain.totalM, (tap.x / size.width).toDouble())
                    if (range != null) {
                        range = null
                        currentOnRange?.invoke(null)
                    }
                    currentOnPick?.invoke(at)
                }
            }
    }

    Column(modifier) {
        Box(Modifier.fillMaxWidth().height(height)) {
            val plotPadding = if (axes) {
                Modifier.padding(start = AXIS_GUTTER, end = 8.dp, top = 10.dp, bottom = AXIS_FOOT)
            } else {
                Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
            }
            Canvas(Modifier.fillMaxWidth().height(height).then(plotPadding).then(picking)) {
                val width = size.width
                val plot = size.height
                fun x(distance: Double) = (distance / terrain.totalM * width).toFloat()
                fun y(altitude: Double) = (plot - (altitude - scale.min) / (scale.max - scale.min) * plot).toFloat()

                if (axes) {
                    scale.values.forEach { value ->
                        drawLine(Tokens.line, Offset(0f, y(value)), Offset(width, y(value)), strokeWidth = 1.dp.toPx())
                        axisLabel(measurer, Format.metres(value), right = -6.dp.toPx(), centreY = y(value))
                    }
                    along.values.forEach { value ->
                        axisLabel(measurer, Format.km(value), centreX = x(value), top = plot + 3.dp.toPx())
                    }
                    axisLabel(measurer, "${Format.km(terrain.totalM)} km", right = width, top = plot + 3.dp.toPx())
                }

                val measured = terrain.altitudeM.indices.filter { terrain.altitudeM[it] != null }
                val brush = if (stops == null || measured.isEmpty()) {
                    SolidColor(Tokens.ink2)
                } else {
                    Brush.horizontalGradient(
                        *stops.map { (offset, colour) ->
                            offset.toFloat() to (colour?.let { Color(0xFF000000L or it.toLong()) } ?: Tokens.ink2)
                        }.toTypedArray(),
                        startX = x(terrain.distances[measured.first()]),
                        endX = x(terrain.distances[measured.last()]),
                    )
                }

                val selected = range
                if (selected != null) {
                    drawRect(
                        Tokens.accent,
                        topLeft = Offset(x(selected.fromM), 0f),
                        size = Size(x(selected.toM) - x(selected.fromM), plot),
                        alpha = 0.07f,
                    )
                }

                // One run per stretch of measured altitude: a dropout is a gap, never a line across it.
                var start = 0
                while (start < terrain.altitudeM.size) {
                    if (terrain.altitudeM[start] == null) {
                        start++
                        continue
                    }
                    var end = start
                    while (end + 1 < terrain.altitudeM.size && terrain.altitudeM[end + 1] != null) end++

                    val line = Path()
                    val area = Path()
                    for (at in start..end) {
                        val px = x(terrain.distances[at])
                        val py = y(terrain.altitudeM[at]!!)
                        if (at == start) {
                            line.moveTo(px, py)
                            area.moveTo(px, plot)
                            area.lineTo(px, py)
                        } else {
                            line.lineTo(px, py)
                            area.lineTo(px, py)
                        }
                    }
                    area.lineTo(x(terrain.distances[end]), plot)
                    area.close()

                    drawPath(area, brush, alpha = if (selected == null) AREA_OPACITY else AREA_OPACITY / 2)
                    drawPath(line, brush, style = Stroke(width = 1.4.dp.toPx()), alpha = if (selected == null) 1f else OUTSIDE_OPACITY)

                    // The selected stretch again at full strength, clipped to the two bars.
                    if (selected != null) {
                        clipRect(left = x(selected.fromM), top = 0f, right = x(selected.toM), bottom = plot) {
                            drawPath(area, brush, alpha = AREA_OPACITY)
                            drawPath(line, brush, style = Stroke(width = 1.8.dp.toPx()))
                        }
                    }
                    start = end + 1
                }

                marksM.forEach { mark ->
                    val px = x(mark.coerceIn(0.0, terrain.totalM))
                    drawLine(
                        Tokens.muted,
                        Offset(px, 0f),
                        Offset(px, plot),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx())),
                    )
                }

                if (selected != null) {
                    listOf(selected.fromM, selected.toM).forEach { edge ->
                        drawLine(Tokens.accentDeep, Offset(x(edge), 0f), Offset(x(edge), plot), strokeWidth = 1.8.dp.toPx())
                    }
                } else {
                    pickedM?.takeIf { it in 0.0..terrain.totalM }?.let { at ->
                        val px = x(at)
                        drawLine(Tokens.ink, Offset(px, 0f), Offset(px, plot), strokeWidth = 1.4.dp.toPx())
                        altitudeAt(terrain.distances, terrain.altitudeM, at)?.let { altitude ->
                            drawCircle(Color.White, radius = 5.5.dp.toPx(), center = Offset(px, y(altitude)))
                            drawCircle(Tokens.ink, radius = 4.dp.toPx(), center = Offset(px, y(altitude)))
                        }
                    }
                }

                youM?.let { at ->
                    val px = x(at.coerceIn(0.0, terrain.totalM))
                    drawLine(
                        Tokens.ink,
                        Offset(px, 0f),
                        Offset(px, plot),
                        strokeWidth = 1.4.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())),
                    )
                    altitudeAt(terrain.distances, terrain.altitudeM, at)?.let { altitude ->
                        drawCircle(Color.White, radius = 5.5.dp.toPx(), center = Offset(px, y(altitude)))
                        drawCircle(Tokens.accent, radius = 4.dp.toPx(), center = Offset(px, y(altitude)))
                    }
                }
            }
        }

        if (axes) {
            val selected = range
            if (selected != null) {
                // What the two bars enclose. No average gradient: a mean over a col is a number about nothing.
                val stats = statsBetween(terrain.distances, terrain.altitudeM, selected.fromM, selected.toM)
                Row(
                    Modifier.fillMaxWidth().padding(start = AXIS_GUTTER, end = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    BasicText("km ${Format.km(selected.fromM)} → ${Format.km(selected.toM)}", style = Type.axis)
                    BasicText("${Format.km(stats.distanceM)} km", style = Type.figure)
                    BasicText("↑ ${Format.metres(stats.ascentM)} m", style = Type.figure)
                    BasicText("↓ ${Format.metres(stats.descentM)} m", style = Type.figure)
                }
            } else {
                // Riding, the split is measured from you; planning, from the bar you put down.
                (youM ?: pickedM)?.let { at ->
                    val split = splitAt(terrain.distances, terrain.altitudeM, at)
                    // No words under them. Which side is behind you and which is ahead is what the bar between them
                    // says, and it says it in the place the eye already is.
                    Row(
                        Modifier.fillMaxWidth().padding(start = AXIS_GUTTER, end = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        BasicText("${Format.km(split.done.distanceM)} km · ↑ ${Format.metres(split.done.ascentM)} m", style = Type.figure)
                        BasicText("${Format.km(split.toCome.distanceM)} km · ↑ ${Format.metres(split.toCome.ascentM)} m", style = Type.figure)
                    }
                }
            }
        }
    }
}

/**
 * One axis label, placed against the edge it belongs to.
 *
 * Measured and drawn on the canvas rather than laid out around it: the labels have to land on the gridlines the same
 * arithmetic put there, and a Column of text beside a Canvas agrees with it only by accident.
 */
private fun DrawScope.axisLabel(
    measurer: TextMeasurer,
    text: String,
    centreX: Float? = null,
    right: Float? = null,
    centreY: Float? = null,
    top: Float? = null,
) {
    val laid = measurer.measure(text, Type.axis)
    val x = when {
        centreX != null -> centreX - laid.size.width / 2f
        right != null -> right - laid.size.width
        else -> 0f
    }
    val y = when {
        centreY != null -> centreY - laid.size.height / 2f
        top != null -> top
        else -> 0f
    }
    drawText(laid, topLeft = Offset(x, y))
}
