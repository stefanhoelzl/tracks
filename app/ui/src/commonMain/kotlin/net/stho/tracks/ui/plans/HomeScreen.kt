package net.stho.tracks.ui.plans

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation as DragOrientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.Orientation
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.sensors.Fix
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Pill
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** How much of the screen the open sheet takes, and how much of it stays when it is pulled down. */
private const val SHEET_SHARE = 0.55f
private val SHEET_PEEK = 150.dp

/**
 * Home: the map centred on you, under a sheet of the plans on this phone, newest first.
 *
 * A tap on a plan opens it. Its ⋯ menu edits it, copies it, shares its link or deletes it. Nothing here starts a ride
 * — riding is M14, and a control that does nothing yet is not drawn.
 */
@Composable
fun HomeScreen(
    style: MapStyle?,
    fix: Fix?,
    plans: List<StoredPlan>,
    routing: Map<String, PlanRouting>,
    notice: String?,
    onPaste: () -> Unit,
    /** Opens recording (M15); without one, there is no Ride button. */
    onRide: (() -> Unit)? = null,
    onOpen: (String) -> Unit,
    onEdit: (String) -> Unit,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** The plan whose ⋯ menu is open as the screen appears: for the screenshots. */
    menuOpen: String? = null,
    onIdle: () -> Unit = {},
) {
    BoxWithConstraints(modifier.fillMaxSize().background(Tokens.ground)) {
        style?.let {
            TracksMap(
                style = it,
                // Centred on you in the part of the map the open sheet leaves.
                camera = MapCamera.Centre(zoom = 13.0, inset = PaddingValues(bottom = maxHeight * SHEET_SHARE)),
                modifier = Modifier.fillMaxSize(),
                fix = fix,
                onIdle = onIdle,
            )
        }

        val density = LocalDensity.current
        val sheetHeight = maxHeight * SHEET_SHARE
        val travel = with(density) { (sheetHeight - SHEET_PEEK).toPx() }.coerceAtLeast(0f)
        val offset = remember { Animatable(0f) }
        val scope = rememberCoroutineScope()

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(sheetHeight)
                .offset { IntOffset(0, offset.value.roundToInt()) }
                .background(Tokens.glassHi, Shapes.sheet),
        ) {
            // The header is what drags the sheet; the list below scrolls.
            Column(
                Modifier
                    .fillMaxWidth()
                    .draggable(
                        state = rememberDraggableState { delta ->
                            scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
                        },
                        orientation = DragOrientation.Vertical,
                        onDragStopped = { velocity ->
                            val down = velocity > 800f || (velocity > -800f && offset.value > travel / 2)
                            offset.animateTo(if (down) travel else 0f)
                        },
                    )
                    .padding(horizontal = 16.dp)
                    .padding(top = 8.dp, bottom = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.width(36.dp).height(5.dp).background(Tokens.line2, Shapes.pill))
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BasicText("Plans", style = Type.title, modifier = Modifier.weight(1f))
                    if (onRide != null) {
                        IconButton(Icons.Ride, "Ride", onClick = onRide)
                        Spacer(Modifier.width(8.dp))
                    }
                    IconButton(Icons.Paste, "Paste link", onClick = onPaste)
                }
                notice?.let { BasicText(it, style = Type.note, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
            }

            if (plans.isEmpty()) {
                BasicText(
                    "No plans yet. Share a plan from tracks.stho.net to the phone, or copy its link and paste it here.",
                    style = Type.note,
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(
                    Modifier.fillMaxWidth().weight(1f).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)),
                ) {
                    items(plans, key = { it.id }) { stored ->
                        PlanRow(
                            stored = stored,
                            routing = routing[stored.id],
                            menuOpen = stored.id == menuOpen,
                            onOpen = { onOpen(stored.id) },
                            onEdit = { onEdit(stored.id) },
                            onCopy = { onCopy(stored.id) },
                            onShare = { onShare(stored.id) },
                            onDelete = { onDelete(stored.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanRow(
    stored: StoredPlan,
    routing: PlanRouting?,
    menuOpen: Boolean,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
) {
    Box(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Tokens.surface)
                .clickable(onClick = onOpen)
                .padding(start = 16.dp, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                BasicText(titleOf(stored.plan), style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicText(numbersOf(stored), style = Type.mono, maxLines = 1)
                statusOf(stored, routing)?.let { BasicText(it, style = Type.note, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }

            PlanMenu(onEdit = onEdit, onCopy = onCopy, onShare = onShare, onDelete = onDelete, initiallyOpen = menuOpen)
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(Tokens.line))
    }
}

/** One thing a ⋯ menu offers: its icon, and the word a screen reader says for it. */
internal class MenuEntry(val icon: ImageVector, val label: String, val onClick: () -> Unit)

/** A plan's ⋯ menu: Edit, Copy, Share link and Delete, the same wherever a plan is shown. Delete does not ask. */
@Composable
internal fun PlanMenu(
    onEdit: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    initiallyOpen: Boolean = false,
) {
    ActionMenu(
        listOf(
            MenuEntry(Icons.Edit, "Edit", onEdit),
            MenuEntry(Icons.Copy, "Copy", onCopy),
            MenuEntry(Icons.Share, "Share link", onShare),
            MenuEntry(Icons.Delete, "Delete", onDelete),
        ),
        modifier,
        initiallyOpen,
    )
}

/** A ⋯ button that opens [entries] below it as one row of icons, all alike and without words. */
@Composable
internal fun ActionMenu(entries: List<MenuEntry>, modifier: Modifier = Modifier, initiallyOpen: Boolean = false) {
    var open by remember { mutableStateOf(initiallyOpen) }
    Box(modifier) {
        Box(
            Modifier.size(48.dp).clickable { open = true }.semantics { contentDescription = "Actions" },
            contentAlignment = Alignment.Center,
        ) {
            BasicText("⋯", style = Type.title.copy(color = Tokens.ink2))
        }
        if (open) {
            // Below the ⋯, not over it: a second tap on ⋯ is outside the menu, and closes it.
            Popup(
                alignment = Alignment.TopEnd,
                offset = with(LocalDensity.current) { IntOffset(0, 48.dp.roundToPx()) },
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                Row(
                    // Lifted off the white it opens over.
                    Modifier.padding(end = 8.dp, bottom = 8.dp).shadow(8.dp, Shapes.panel).background(Tokens.surface, Shapes.panel).padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    entries.forEach { entry ->
                        MenuIcon(entry) {
                            open = false
                            entry.onClick()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuIcon(entry: MenuEntry, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clickable(onClick = onClick).semantics { contentDescription = entry.label },
        contentAlignment = Alignment.Center,
    ) {
        Image(entry.icon, contentDescription = null, modifier = Modifier.size(20.dp), colorFilter = ColorFilter.tint(Tokens.ink))
    }
}
