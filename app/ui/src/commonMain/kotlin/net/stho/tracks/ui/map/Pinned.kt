package net.stho.tracks.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.time.Duration.Companion.milliseconds
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.theme.Tokens
import org.maplibre.compose.map.MapState
import org.maplibre.spatialk.geojson.Position

/**
 * A card that stands on a place on the map: the waypoint dialog, over the waypoint it is about — as the web's does.
 *
 * [inset] is what covers the map's edges (the top of the screen, and the sheet at the bottom), so the card is kept to
 * what can be seen of it: centred above the place, slid sideways at an edge with its tail still on the place, and hung
 * below instead when there is no room above. A place opened where it cannot be seen — a stop picked from the list that
 * is under the sheet — brings the map to it, by as little as puts it in view.
 */
class Pinned(val at: Coordinate, val inset: PaddingValues, val content: @Composable () -> Unit)

/** How close the card comes to an edge of what can be seen. */
private val EDGE = 8.dp

/** How far above its place the card sits: clear of the waypoint's marker. The web's `PIN_OFFSET_PX`. */
private val OFFSET = 14.dp

/** The tail that points at the place, drawn as a turned square half under the card. */
private val TAIL = 12.dp

@Composable
internal fun PinnedCard(state: MapState, pinned: Pinned) {
    // Read so the card follows the camera: the position is Compose state.
    state.cameraPosition
    val screen = runCatching { state.screenLocationFromPosition(Position(pinned.at.lon, pinned.at.lat)) }.getOrNull() ?: return
    val direction = LocalLayoutDirection.current
    val density = LocalDensity.current
    var size by remember { mutableStateOf(IntSize.Zero) }

    LaunchedEffect(pinned.at, size) {
        if (size == IntSize.Zero || state.isCameraMoving) return@LaunchedEffect
        val here = runCatching { state.screenLocationFromPosition(Position(pinned.at.lon, pinned.at.lat)) }.getOrNull()
            ?: return@LaunchedEffect
        with(density) {
            val width = size.width.toDp()
            val height = size.height.toDp()
            val inset = pinned.inset
            val minX = inset.calculateLeftPadding(direction) + EDGE
            val maxX = width - inset.calculateRightPadding(direction) - EDGE
            val minY = inset.calculateTopPadding() + EDGE
            val maxY = height - inset.calculateBottomPadding() - EDGE * 3
            if (maxX <= minX || maxY <= minY) return@LaunchedEffect
            val dx = when {
                here.x < minX -> here.x - minX
                here.x > maxX -> here.x - maxX
                else -> 0.dp
            }
            val dy = when {
                here.y < minY -> here.y - minY
                here.y > maxY -> here.y - maxY
                else -> 0.dp
            }
            if (dx == 0.dp && dy == 0.dp) return@LaunchedEffect
            val target = state.positionFromScreenLocation(DpOffset(width / 2 + dx, height / 2 + dy)) ?: return@LaunchedEffect
            state.animateCameraPosition(state.cameraPosition.copy(target = target), duration = 300.milliseconds)
        }
    }

    Layout(
        modifier = Modifier.onSizeChanged { size = it },
        content = {
            Box(Modifier.size(TAIL).graphicsLayer { rotationZ = 45f }.background(Tokens.surface))
            // The card takes every touch that lands on it, so a tap between its buttons is not a tap on the map.
            Box(
                Modifier.pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) awaitPointerEvent().changes.forEach { it.consume() }
                    }
                },
            ) { pinned.content() }
        },
    ) { measurables, constraints ->
        val tail = measurables[0].measure(Constraints())
        val card = measurables[1].measure(constraints.copy(minWidth = 0, minHeight = 0))
        layout(constraints.maxWidth, constraints.maxHeight) {
            val x = screen.x.roundToPx()
            val y = screen.y.roundToPx()
            val edge = EDGE.roundToPx()
            val offset = OFFSET.roundToPx()
            val top = pinned.inset.calculateTopPadding().roundToPx() + edge
            val left = (x - card.width / 2).coerceIn(edge, max(edge, constraints.maxWidth - edge - card.width))
            val below = y - offset - card.height < top
            val cardY = if (below) y + offset else y - offset - card.height
            // The tail first, so the card draws over half of it and only its point shows.
            tail.place(x - tail.width / 2, if (below) cardY - tail.height / 2 else cardY + card.height - tail.height / 2)
            card.place(left, cardY)
        }
    }
}

