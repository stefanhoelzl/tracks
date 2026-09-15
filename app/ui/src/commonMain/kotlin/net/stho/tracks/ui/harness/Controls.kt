package net.stho.tracks.ui.harness

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.stho.tracks.ui.theme.Tokens

/** Glass behind a readout, over the map. */
@Composable
internal fun Pill(content: @Composable () -> Unit) {
    Box(Modifier.background(Tokens.glassHi, RoundedCornerShape(9.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) { content() }
}

/** A button, in the accent; [quiet] for the one that is not the thing you most likely came to press. */
@Composable
internal fun Button(label: String, quiet: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.background(if (quiet) Tokens.accentSoft else Tokens.accent, RoundedCornerShape(999.dp)).clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        BasicText(label, style = TextStyle(color = if (quiet) Tokens.accentDeep else Tokens.surface, fontSize = 14.sp))
    }
}
