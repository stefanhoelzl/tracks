package net.stho.tracks.ui.harness

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.stho.tracks.ui.theme.Tokens

/*
 * The few controls the harness and its stand-ins draw with, until the app has screens of its own to set a style.
 */

/** Glass behind a readout, over the map. */
@Composable
internal fun Pill(content: @Composable () -> Unit) {
    Box(Modifier.background(Tokens.glassHi, RoundedCornerShape(9.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) { content() }
}

@Composable
internal fun Label(text: String) = BasicText(text, style = TextStyle(color = Tokens.ink, fontSize = 13.sp))

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

/** A card across the bottom of the screen, for a question that wants an answer. */
@Composable
internal fun Sheet(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
internal fun Title(text: String) =
    BasicText(text, style = TextStyle(color = Tokens.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold))

/** One line of text to edit, with its [label] above it; [secret] for a password. */
@Composable
internal fun Field(value: String, onValueChange: (String) -> Unit, label: String? = null, secret: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        label?.let { BasicText(it, style = TextStyle(color = Tokens.muted, fontSize = 12.sp)) }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = Tokens.ink, fontSize = 15.sp),
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            modifier = Modifier.fillMaxWidth().border(1.dp, Tokens.line2, RoundedCornerShape(9.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}
