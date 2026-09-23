package net.stho.tracks.ui.theme

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import net.stho.tracks.ui.map.UNDER_MAP_CREDIT

/** What the open sheet leaves above it: the map's attribution and the screen's own buttons. */
private val TOP_CLEARANCE = UNDER_MAP_CREDIT + 56.dp

/** Where a [SnapSheet] rests: its header only, half the screen, or open to the top. */
enum class SheetDetent { Header, Half, Full }

/**
 * A sheet that rests at one of its [detents]: minimised to its [header], at half the screen, or open to the top of the
 * screen with [content] under the header. A drag on the header snaps to whichever detent it is let go nearest — or one
 * step the way it was flung — and a tap on it steps up one, from the top back to the bottom, as the riding sheet and the
 * web's sheet do.
 *
 * The plan preview has two detents; the editor has all three, as the web's sheet does, because a plan is edited with
 * the map and the stops both in view.
 *
 * [onHeaderHeight] reports how much of the screen the minimised sheet covers, for a map to keep what it frames clear of
 * it; [onCovered] reports how much it covers where it rests now, for a card on the map to stay out from under it.
 */
@Composable
fun SnapSheet(
    detent: SheetDetent,
    onDetent: (SheetDetent) -> Unit,
    modifier: Modifier = Modifier,
    detents: List<SheetDetent> = listOf(SheetDetent.Header, SheetDetent.Full),
    onHeaderHeight: (Dp) -> Unit = {},
    onCovered: (Dp) -> Unit = {},
    header: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val full = maxHeight - TOP_CLEARANCE
        val fullPx = with(density) { full.toPx() }
        val bottomInset = WindowInsets.safeDrawing.getBottom(density)
        var headerPx by remember { mutableIntStateOf(0) }
        val travel = (fullPx - headerPx - bottomInset).coerceAtLeast(0f)
        val halfPx = with(density) { (maxHeight / 2).toPx() }
        fun offsetOf(at: SheetDetent) = when (at) {
            SheetDetent.Full -> 0f
            SheetDetent.Half -> (fullPx - halfPx).coerceIn(0f, travel)
            SheetDetent.Header -> travel
        }
        val offset = remember { Animatable(0f) }
        var placed by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()

        // Where the sheet rests. Placed without animation until the header has been measured, so it never opens
        // itself on the way to being minimised.
        LaunchedEffect(detent, travel) {
            val target = offsetOf(detent)
            onCovered(with(density) { (fullPx - target).toDp() })
            if (placed) {
                offset.animateTo(target)
            } else {
                offset.snapTo(target)
                if (headerPx > 0) placed = true
            }
        }

        fun step(by: Int): SheetDetent {
            val at = detents.indexOf(detent).coerceAtLeast(0)
            return detents[(at + by).coerceIn(0, detents.lastIndex)]
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(full)
                .offset { IntOffset(0, offset.value.roundToInt()) }
                .background(Tokens.glassHi, Shapes.sheet),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .onSizeChanged {
                        headerPx = it.height
                        onHeaderHeight(with(density) { (it.height + bottomInset).toDp() })
                    }
                    .draggable(
                        state = rememberDraggableState { delta ->
                            scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
                        },
                        orientation = Orientation.Vertical,
                        onDragStopped = { velocity ->
                            val next = when {
                                velocity < -800f -> step(+1)
                                velocity > 800f -> step(-1)
                                else -> detents.minBy { kotlin.math.abs(offsetOf(it) - offset.value) }
                            }
                            onDetent(next)
                            offset.animateTo(offsetOf(next))
                        },
                    )
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        val at = detents.indexOf(detent).coerceAtLeast(0)
                        onDetent(detents[(at + 1) % detents.size])
                    }
                    .padding(horizontal = 16.dp)
                    .padding(top = 8.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(5.dp).background(Tokens.line2, Shapes.pill))
                header()
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                    .padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                content()
            }
        }
    }
}
