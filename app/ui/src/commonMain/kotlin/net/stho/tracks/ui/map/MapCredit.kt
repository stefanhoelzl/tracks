package net.stho.tracks.ui.map

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import org.maplibre.compose.camera.CameraMoveReason
import org.maplibre.compose.overlay.AttributionDefaults
import org.maplibre.compose.overlay.AttributionLinks
import org.maplibre.compose.overlay.MapOverlayScope
import org.maplibre.compose.overlay.attributions

/** Where a screen's own controls at the top of the map start: below the map's credit, open. */
val UNDER_MAP_CREDIT = 44.dp

/**
 * The credit OpenStreetMap's licence asks for, as its attribution guidelines allow it on a small screen: open on the
 * first map of a launch, collapsed to an ⓘ on the first pan or zoom or after [openFor], and an ⓘ on every map after.
 * The ⓘ opens it again.
 */
object MapCredit {
    /** Whether a map has shown the credit open yet, this launch. */
    var shown = false

    /** How long the first map shows it open unless the map is moved first. The screenshot scenes hold it open. */
    var openFor: Duration = 5.seconds
}

private val CREDIT_TEXT = TextStyle(color = Tokens.ink2, fontSize = 11.sp)
private val CREDIT_BUTTON = 28.dp
private val CREDIT_ICON = 18.dp

@Composable
internal fun MapOverlayScope.MapCreditButton() {
    var open by remember { mutableStateOf(!MapCredit.shown) }
    val map = mapState

    LaunchedEffect(Unit) {
        if (!open) return@LaunchedEffect
        MapCredit.shown = true
        delay(MapCredit.openFor)
        open = false
    }
    LaunchedEffect(map.isCameraMoving, map.cameraMoveReason) {
        if (map.isCameraMoving && map.cameraMoveReason == CameraMoveReason.GESTURE) open = false
    }

    val mapStyle = style
    val attributions by remember(mapStyle) { derivedStateOf { mapStyle.attributions() } }
    if (attributions.isEmpty()) return

    Row(
        Modifier
            .background(Tokens.glass, Shapes.pill)
            .clip(Shapes.pill)
            // Without this, a drag across the credit pans the map underneath it.
            .pointerInput(Unit) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(open, enter = expandHorizontally(), exit = shrinkHorizontally()) {
            AttributionLinks(attributions, Modifier.padding(start = 12.dp, top = 6.dp, bottom = 6.dp), textStyle = CREDIT_TEXT)
        }
        Box(
            Modifier.size(CREDIT_BUTTON).clip(Shapes.pill).clickable(role = Role.Button) { open = !open },
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = AttributionDefaults.icon(),
                contentDescription = AttributionDefaults.contentDescription(),
                modifier = Modifier.size(CREDIT_ICON),
                colorFilter = ColorFilter.tint(Tokens.ink2),
            )
        }
    }
}
