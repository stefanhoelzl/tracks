package net.stho.tracks.ui.recording

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import net.stho.tracks.recording.SPORTS
import net.stho.tracks.ui.harness.Button
import net.stho.tracks.ui.harness.Pill
import net.stho.tracks.ui.theme.Tokens

/**
 * Recording's own controls: record, pause and stop, the offer to continue an interrupted ride, and the Save sheet.
 *
 * A stand-in for how a ride starts until riding (M14) exists — there, starting a plan or *Ride* starts the recorder, and
 * this is what is left of it: the Save sheet, and the readouts' distance and metres climbed.
 */
@Composable
fun RecordingControls(recorder: Recorder) {
    val state by recorder.state.collectAsState()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        when (val s = state) {
            RecorderState.Idle -> Button("Record") { recorder.start() }

            is RecorderState.Recording -> {
                Pill {
                    val climbed = s.climbedM?.let { "${it.roundToInt()} m climbed" } ?: "no barometer"
                    Label((if (s.paused) "Paused · " else "Recording · ") + "${kilometres(s.distanceM)} · $climbed")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (s.paused) Button("Resume") { recorder.resume() } else Button("Pause", quiet = true) { recorder.pause() }
                    Button("Stop") { recorder.stop() }
                }
            }

            is RecorderState.Interrupted -> {
                Pill { Label("A ride was interrupted at ${kilometres(s.distanceM)}") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button("Stop", quiet = true) { recorder.stop() }
                    Button("Continue") { recorder.continueRide() }
                }
            }

            is RecorderState.Stopped -> SaveRideSheet(s, onSave = recorder::save, onDiscard = recorder::discard)
        }
    }
}

/** *Save ride?*, already filled in: a title and a sport to change if they are wrong, and two answers. */
@Composable
fun SaveRideSheet(stopped: RecorderState.Stopped, onSave: (title: String, sport: String) -> Unit, onDiscard: () -> Unit) {
    var title by remember(stopped.id) { mutableStateOf(stopped.title) }
    var sport by remember(stopped.id) { mutableStateOf(stopped.sport) }

    Column(
        Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BasicText("Save ride?", style = TextStyle(color = Tokens.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold))
        BasicTextField(
            value = title,
            onValueChange = { title = it },
            singleLine = true,
            textStyle = TextStyle(color = Tokens.ink, fontSize = 15.sp),
            modifier = Modifier.fillMaxWidth().border(1.dp, Tokens.line2, RoundedCornerShape(9.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
        )
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

@Composable
private fun Label(text: String) = BasicText(text, style = TextStyle(color = Tokens.ink, fontSize = 13.sp))

private fun kilometres(metres: Double): String {
    val tenths = (metres / 100).roundToInt()
    return "${tenths / 10}.${tenths % 10} km"
}
