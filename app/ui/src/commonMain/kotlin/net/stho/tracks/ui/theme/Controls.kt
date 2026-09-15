package net.stho.tracks.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** `--radius-panel`, `--radius-ctrl`, `--radius-pill`. */
object Shapes {
    val panel = RoundedCornerShape(14.dp)
    val sheet = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
    val control = RoundedCornerShape(9.dp)
    val pill = RoundedCornerShape(999.dp)
}

/** A rounded button: accent for the thing to do, glass for the way back. */
@Composable
fun Pill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = true) {
    Box(
        modifier
            .background(if (primary) Tokens.accent else Tokens.glassHi, Shapes.pill)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        BasicText(label, style = if (primary) Type.control else Type.control.copy(color = Tokens.ink))
    }
}

/** One big number with its unit: the web's four-up metric grid. */
@Composable
fun StatTile(label: String, value: String, unit: String, modifier: Modifier = Modifier) {
    Column(
        modifier.background(Tokens.sunk, Shapes.control).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        BasicText(label.uppercase(), style = Type.label)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            BasicText(value, style = Type.number)
            BasicText(unit, style = Type.unit, modifier = Modifier.padding(bottom = 3.dp))
        }
    }
}
