package net.stho.tracks.ui.riding

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.riding.Detour
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** A place a long press on the riding map picked: where, and the name the map labels it with, when it has one. */
data class DetourTarget(val at: Coordinate, val name: String?)

/**
 * What a long press on the riding map offers, as the editor's dialog offers it — icons without words, placing a stop in
 * accent and the rest quiet — cut to what makes sense mid-ride: *Through* the leg you are on, a *Stop* on it, or a new
 * *End* after the finish. Nothing changes until one is chosen; × or ignoring it leaves the plan as it was.
 */
@Composable
fun DetourDialog(target: DetourTarget, onDetour: (Detour) -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().background(Tokens.surface, Shapes.panel).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicText(target.name ?: "Waypoint", style = Type.title, modifier = Modifier.weight(1f))
            Box(
                Modifier.size(40.dp).clickable(onClick = onClose).semantics { contentDescription = "Close" },
                contentAlignment = Alignment.Center,
            ) {
                BasicText("×", style = Type.title.copy(color = Tokens.muted))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(Icons.Shaping, "Route through", onClick = { onDetour(Detour.Through) }, primary = false)
            IconButton(Icons.Stop, "Stop", onClick = { onDetour(Detour.Stop) })
            IconButton(Icons.End, "End", onClick = { onDetour(Detour.End) })
        }
    }
}
