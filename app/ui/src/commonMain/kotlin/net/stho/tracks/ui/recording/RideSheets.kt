package net.stho.tracks.ui.recording

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import net.stho.tracks.recording.SPORTS
import net.stho.tracks.ui.harness.Button
import net.stho.tracks.ui.harness.Field
import net.stho.tracks.ui.harness.Label
import net.stho.tracks.ui.harness.Sheet
import net.stho.tracks.ui.harness.Title

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

/** *Save ride?*, already filled in: a title and a sport to change if they are wrong, and two answers. */
@Composable
fun SaveRideSheet(stopped: RecorderState.Stopped, onSave: (title: String, sport: String) -> Unit, onDiscard: () -> Unit) {
    var title by remember(stopped.id) { mutableStateOf(stopped.title) }
    var sport by remember(stopped.id) { mutableStateOf(stopped.sport) }

    Sheet {
        Title("Save ride?")
        Field(title, onValueChange = { title = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SPORTS.forEach { value ->
                Button(value.replaceFirstChar { it.uppercase() }, quiet = value != sport) { sport = value }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            Button("Discard", quiet = true, onClick = onDiscard)
            Button("Save") { onSave(title, sport) }
        }
    }
}

private fun kilometres(metres: Double): String {
    val tenths = (metres / 100).roundToInt()
    return "${tenths / 10}.${tenths % 10} km"
}
