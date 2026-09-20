package net.stho.tracks.ui.plans

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.safeDrawingPadding
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
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import net.stho.tracks.ui.offline.PlanOffline
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type
import net.stho.tracks.ui.upload.UploadQueue
import net.stho.tracks.ui.upload.SignInSheet
import net.stho.tracks.ui.upload.UploadStatus

/** How much of the screen the open sheet takes, and how much of it stays when it is pulled down. */
private const val SHEET_SHARE = 0.55f
private val SHEET_PEEK = 150.dp

/**
 * Home: the map centred on you, under a sheet of the plans on this phone, newest first.
 *
 * + starts a plan from nothing, in the editor. A tap on a plan opens it. Its ⋯ menu navigates it — a ride that follows
 * it — edits it, copies it, shares its link or deletes it. Ride starts a ride with no plan, under the same arrow as
 * Navigate. A plan arrives from outside by its link, opened on the phone. What the upload queue has to say, and
 * signing in, sit under the buttons.
 */
@Composable
fun HomeScreen(
    style: MapStyle?,
    fix: Fix?,
    plans: List<StoredPlan>,
    routing: Map<String, PlanRouting>,
    notice: String?,
    onNew: () -> Unit,
    /** Starts a ride with no plan; without one, there is no Ride button. */
    onRide: (() -> Unit)? = null,
    /** Starts a ride that follows a plan; without one, no menu has Navigate. */
    onNavigate: ((String) -> Unit)? = null,
    onOpen: (String) -> Unit,
    onEdit: (String) -> Unit,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** The plan whose ⋯ menu is open as the screen appears: for the screenshots. */
    menuOpen: String? = null,
    /** Where a plan stands offline (M13), by its id; null says nothing about it. */
    offline: (String) -> PlanOffline? = { null },
    upload: UploadQueue? = null,
    onIdle: () -> Unit = {},
) {
    // Signing in belongs to the screen, not to the status line that asks for it: the sheet has to
    // sit at the bottom of the *screen* to rise above the keyboard, and the status line lives in a
    // header that neither scrolls nor moves.
    var signingIn by remember { mutableStateOf(false) }

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
                        IconButton(Icons.Navigate, "Ride", onClick = onRide, tint = Tokens.accent)
                        Spacer(Modifier.width(8.dp))
                    }
                    IconButton(Icons.New, "New plan", onClick = onNew, tint = Tokens.accent)
                }
                notice?.let { BasicText(it, style = Type.note, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
                upload?.let { Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) { UploadStatus(it, onSignIn = { signingIn = true }) } }
            }

            if (plans.isEmpty()) {
                BasicText(
                    "No plans yet. Tap + to plan one, or open a plan's link from tracks.stho.net.",
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
                            offline = offline(stored.id),
                            onOpen = { onOpen(stored.id) },
                            onNavigate = onNavigate?.let { navigate -> { navigate(stored.id) } },
                            onEdit = { onEdit(stored.id) },
                            onCopy = { onCopy(stored.id) },
                            onShare = { onShare(stored.id) },
                            onDelete = { onDelete(stored.id) },
                        )
                    }
                }
            }
        }

        if (signingIn && upload != null) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(Tokens.scrim)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { signingIn = false },
            )
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(12.dp)) {
                SignInSheet(upload, onClose = { signingIn = false })
            }
        }
    }
}

@Composable
private fun PlanRow(
    stored: StoredPlan,
    routing: PlanRouting?,
    menuOpen: Boolean,
    offline: PlanOffline?,
    onOpen: () -> Unit,
    onNavigate: (() -> Unit)?,
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
                // Where the plan stands offline leads its numbers, small, so the marks line up down the list.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    OfflineBadge(offline)
                    BasicText(numbersOf(stored), style = Type.mono, maxLines = 1)
                }
                statusOf(stored, routing)?.let { BasicText(it, style = Type.note, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }

            PlanMenu(onEdit = onEdit, onCopy = onCopy, onShare = onShare, onDelete = onDelete, onNavigate = onNavigate, initiallyOpen = menuOpen)
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(Tokens.line))
    }
}

/**
 * One thing a ⋯ menu offers: its icon, and the word a screen reader says for it. [tint] is what it does rather than how
 * much it matters — green goes forward, red takes something away, black is neutral.
 */
internal class MenuEntry(val icon: ImageVector, val label: String, val onClick: () -> Unit, val tint: Color = Tokens.ink)

/**
 * A plan's ⋯ menu: Navigate, Edit, Copy, Share link and Delete, the same wherever a plan is shown. Navigate is there when
 * there is a way to ride; Delete does not ask.
 */
@Composable
internal fun PlanMenu(
    onEdit: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    onNavigate: (() -> Unit)? = null,
    initiallyOpen: Boolean = false,
) {
    ActionMenu(
        listOfNotNull(
            onNavigate?.let { MenuEntry(Icons.Navigate, "Navigate", it) },
            MenuEntry(Icons.Edit, "Edit", onEdit),
            MenuEntry(Icons.Copy, "Copy", onCopy),
            MenuEntry(Icons.Share, "Share link", onShare),
            MenuEntry(Icons.Delete, "Delete", onDelete, tint = Tokens.bad),
        ),
        modifier,
        initiallyOpen,
    )
}

/**
 * A ⋯ button that opens [entries] as one row of icons without words: below it, or above it when [opensUp] — for a ⋯ at
 * the bottom of the screen.
 */
@Composable
internal fun ActionMenu(entries: List<MenuEntry>, modifier: Modifier = Modifier, initiallyOpen: Boolean = false, opensUp: Boolean = false) {
    var open by remember { mutableStateOf(initiallyOpen) }
    Box(modifier) {
        Box(
            Modifier.size(48.dp).clickable { open = true }.semantics { contentDescription = "Actions" },
            contentAlignment = Alignment.Center,
        ) {
            BasicText("⋯", style = Type.title.copy(color = Tokens.ink2))
        }
        if (open) {
            // Beside the ⋯, not over it: a second tap on ⋯ is outside the menu, and closes it.
            Popup(
                popupPositionProvider = remember(opensUp) { MenuPosition(opensUp) },
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                Row(
                    // Lifted off the white it opens over.
                    Modifier.padding(end = 8.dp, top = if (opensUp) 8.dp else 0.dp, bottom = if (opensUp) 0.dp else 8.dp)
                        .shadow(8.dp, Shapes.panel).background(Tokens.surface, Shapes.panel).padding(4.dp),
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

/** Its right edge on the ⋯'s, and its top on the ⋯'s bottom — or its bottom on the ⋯'s top. */
private class MenuPosition(private val opensUp: Boolean) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize) =
        IntOffset(
            (anchorBounds.right - popupContentSize.width).coerceAtLeast(0),
            if (opensUp) anchorBounds.top - popupContentSize.height else anchorBounds.bottom,
        )
}

@Composable
private fun MenuIcon(entry: MenuEntry, onClick: () -> Unit) {
    IconButton(entry.icon, entry.label, onClick, tint = entry.tint)
}
