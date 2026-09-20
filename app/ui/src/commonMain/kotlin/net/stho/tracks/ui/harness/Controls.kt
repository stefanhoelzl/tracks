package net.stho.tracks.ui.harness

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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

/**
 * A button, in the accent; [quiet] for the one that is not the thing you most likely came to press,
 * and [bad] for the one that takes something away.
 */
@Composable
internal fun Button(label: String, quiet: Boolean = false, bad: Boolean = false, onClick: () -> Unit) {
    // Quiet stays the soft accent pill it has always been; there is no soft red, and a red pill for
    // Discard would shout louder than the Save beside it, so a quiet bad button is its word in red.
    val fill = when {
        quiet && bad -> Color.Transparent
        quiet -> Tokens.accentSoft
        bad -> Tokens.bad
        else -> Tokens.accent
    }
    val ink = when {
        quiet && bad -> Tokens.bad
        quiet -> Tokens.accentDeep
        else -> Tokens.surface
    }
    Box(
        Modifier.background(fill, RoundedCornerShape(999.dp)).clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        BasicText(label, style = TextStyle(color = ink, fontSize = 14.sp))
    }
}

/**
 * A card across the bottom of the screen, for a question that wants an answer: [content] above,
 * and the [actions] that answer it pinned along the bottom.
 *
 * **The answers never move.** A sheet used to be one column, so anything that grew inside it —
 * an error as long as whatever the network threw — pushed the buttons down, and with the keyboard
 * up they went off the screen with no way to scroll to them. Now the body scrolls under a fixed
 * row of answers, and the card lifts above the keyboard. Every sheet with a field in it had the
 * same bug waiting.
 */
@Composable
internal fun Sheet(actions: @Composable RowScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().imePadding().background(Tokens.surface, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            // Capped rather than weighted: the sheet is as tall as it needs to be inside whatever
            // hosts it, and only a body longer than this one screenful of card ever scrolls.
            Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            actions()
        }
    }
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
