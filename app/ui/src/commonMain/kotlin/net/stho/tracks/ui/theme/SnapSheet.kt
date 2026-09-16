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

/**
 * A sheet with two states and nothing between them: minimised to its [header], or open to the top of the screen with
 * [content] under the header. A drag on the header snaps to whichever state it is let go nearer — or flung towards —
 * and a tap on it switches.
 *
 * [onHeaderHeight] reports how much of the screen the minimised sheet covers, for a map to keep what it frames clear
 * of it.
 */
@Composable
fun SnapSheet(
    expanded: Boolean,
    onExpanded: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    onHeaderHeight: (Dp) -> Unit = {},
    header: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val full = maxHeight - TOP_CLEARANCE
        val bottomInset = WindowInsets.safeDrawing.getBottom(density)
        var headerPx by remember { mutableIntStateOf(0) }
        val travel = (with(density) { full.toPx() } - headerPx - bottomInset).coerceAtLeast(0f)
        val offset = remember { Animatable(0f) }
        var placed by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()

        // Where the sheet rests. Placed without animation until the header has been measured, so it never opens
        // itself on the way to being minimised.
        LaunchedEffect(expanded, travel) {
            val target = if (expanded) 0f else travel
            if (placed) {
                offset.animateTo(target)
            } else {
                offset.snapTo(target)
                if (headerPx > 0) placed = true
            }
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
                            val open = velocity < -800f || (velocity <= 800f && offset.value < travel / 2)
                            onExpanded(open)
                            offset.animateTo(if (open) 0f else travel)
                        },
                    )
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        onExpanded(!expanded)
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
