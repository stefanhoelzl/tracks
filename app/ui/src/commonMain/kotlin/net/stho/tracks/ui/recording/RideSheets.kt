package net.stho.tracks.ui.recording

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import net.stho.tracks.recording.SPORTS
import net.stho.tracks.ui.harness.Button
import net.stho.tracks.ui.harness.Field
import net.stho.tracks.ui.harness.Label
import net.stho.tracks.ui.harness.Sheet
import net.stho.tracks.ui.harness.Title
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Tokens

/** A ride the app died during, found as it started again: continue it where the journal left it, or stop it there. */
@Composable
fun InterruptedSheet(interrupted: RecorderState.Interrupted, onContinue: () -> Unit, onStop: () -> Unit) {
    Sheet {
        Title("A ride was interrupted")
        Label("It had ${kilometres(interrupted.distanceM)} when the app was ended.")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            Button("Stop", quiet = true, onClick = onStop)
            Button("Continue", onClick = onContinue)
        }
    }
}

/**
 * *Save ride?*, already filled in: a title and a sport to change if they are wrong, and three answers. Continue takes
 * the ride up again, for a Stop pressed by mistake.
 */
@Composable
fun SaveRideSheet(
    stopped: RecorderState.Stopped,
    onSave: (title: String, sport: String) -> Unit,
    onContinue: () -> Unit,
    onDiscard: () -> Unit,
) {
    var title by remember(stopped.id) { mutableStateOf(stopped.title) }
    var sport by remember(stopped.id) { mutableStateOf(stopped.sport) }

    Sheet {
        Title("Save ride?")
        Field(title, onValueChange = { title = it })
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SPORTS.forEach { value -> SportButton(value, chosen = value == sport) { sport = value } }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button("Discard", quiet = true, onClick = onDiscard)
            Spacer(Modifier.weight(1f))
            Button("Continue", quiet = true, onClick = onContinue)
            Button("Save") { onSave(title, sport) }
        }
    }
}

/** A sport as its figure, and no word: the chosen one in the accent. The word is what a screen reader says. */
@Composable
private fun SportButton(sport: String, chosen: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(48.dp)
            .background(if (chosen) Tokens.accent else Tokens.sunk, CircleShape)
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = sport.replaceFirstChar { it.uppercase() }
                selected = chosen
            },
        contentAlignment = Alignment.Center,
    ) {
        val icon = when (sport) {
            "hike" -> Icons.Hike
            "run" -> Icons.Run
            else -> Icons.Bike
        }
        Image(icon, contentDescription = null, modifier = Modifier.size(24.dp), colorFilter = ColorFilter.tint(if (chosen) Tokens.surface else Tokens.ink))
    }
}

private fun kilometres(metres: Double): String {
    val tenths = (metres / 100).roundToInt()
    return "${tenths / 10}.${tenths % 10} km"
}
