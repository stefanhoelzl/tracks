package net.stho.tracks.ui.plans

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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Placement
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** What the dialog is about: a place not yet in the plan, or a waypoint that is. */
sealed interface PinTarget {
    /** [leg] is the leg the place is nearest, if the plan has one. [name] is known when the place came from a search or a map label. */
    data class New(val at: Coordinate, val leg: Int?, val name: String?) : PinTarget

    data class Edit(val index: Int, val waypoint: Waypoint) : PinTarget
}

/**
 * The one thing that commits a waypoint and the one thing that edits one, as on the web: however a place was found —
 * a tap on the map, a search result — adding it is this; and a waypoint's name, kind and removal are here.
 *
 * Its choices are one row of icons without words, each named for a screen reader: placing a stop in accent, the rest
 * quiet.
 */
@Composable
fun WaypointDialog(
    target: PinTarget,
    count: Int,
    kindIsAChoice: Boolean,
    onAdd: (WaypointKind, Placement) -> Unit,
    onKind: (WaypointKind) -> Unit,
    onRename: (String) -> Unit,
    onRemove: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxWidth().background(Tokens.surface, Shapes.panel).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when (target) {
            is PinTarget.New -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicText(target.name ?: "Waypoint", style = Type.title, modifier = Modifier.weight(1f))
                    Close(onClose)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Splitting a leg is on offer as soon as there is a leg to split.
                    if (target.leg != null) {
                        IconButton(Icons.Mid, "Insert", onClick = { onAdd(WaypointKind.Poi, Placement.Nearest) }, tint = Tokens.accent)
                    }
                    if (count == 0) {
                        // The first waypoint is where the line starts, whatever the button is called.
                        IconButton(Icons.Start, "Add", onClick = { onAdd(WaypointKind.Poi, Placement.End) }, tint = Tokens.accent)
                    } else {
                        IconButton(Icons.Start, "Start", onClick = { onAdd(WaypointKind.Poi, Placement.Start) }, tint = Tokens.accent)
                        IconButton(Icons.End, "End", onClick = { onAdd(WaypointKind.Poi, Placement.End) }, tint = Tokens.accent)
                    }
                    // A shaping hint with no leg to shape has nowhere to go.
                    if (kindIsAChoice && target.leg != null) {
                        IconButton(Icons.Shaping, "Shaping point", onClick = { onAdd(WaypointKind.Routing, Placement.Nearest) })
                    }
                }
            }

            is PinTarget.Edit -> {
                var name by remember(target) { mutableStateOf(target.waypoint.name ?: "") }
                val done = {
                    if (target.waypoint.kind == WaypointKind.Poi && name.trim() != (target.waypoint.name ?: "")) onRename(name.trim())
                    onClose()
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (target.waypoint.kind == WaypointKind.Poi) {
                        BasicTextField(
                            value = name,
                            onValueChange = { name = it },
                            singleLine = true,
                            textStyle = Type.title,
                            cursorBrush = SolidColor(Tokens.accent),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { done() }),
                            decorationBox = { field ->
                                Box {
                                    if (name.isEmpty()) BasicText("Name this stop", style = Type.title.copy(color = Tokens.muted))
                                    field()
                                }
                            },
                            modifier = Modifier.weight(1f),
                        )
                    } else {
                        BasicText("Shaping point", style = Type.title, modifier = Modifier.weight(1f))
                    }
                    Close(done)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // POI is a break and ROUTING a pass-through, so flipping the kind merges or splits a leg.
                    if (kindIsAChoice) {
                        val poi = target.waypoint.kind == WaypointKind.Poi
                        IconButton(
                            if (poi) Icons.Shaping else Icons.Mid,
                            if (poi) "Make shaping" else "Make a stop",
                            onClick = { onKind(if (poi) WaypointKind.Routing else WaypointKind.Poi) },
                            tint = if (poi) Tokens.ink else Tokens.accent,
                        )
                    }
                    IconButton(Icons.Delete, "Remove", onClick = onRemove, tint = Tokens.bad)
                }
            }
        }
    }
}

@Composable
private fun Close(onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clickable(onClick = onClick).semantics { contentDescription = "Close" }, contentAlignment = Alignment.Center) {
        BasicText("×", style = Type.title.copy(color = Tokens.muted))
    }
}
