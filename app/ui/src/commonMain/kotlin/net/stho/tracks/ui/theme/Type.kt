package net.stho.tracks.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The web's type steps (`--text-*` in tokens.css), each a step or two larger: a phone is read at arm's length, often
 * moving, where the web's panel is read at a desk. Weights and tracking are the web's.
 */
object Type {
    val title = TextStyle(color = Tokens.ink, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.03).em)
    val body = TextStyle(color = Tokens.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    val note = TextStyle(color = Tokens.ink2, fontSize = 13.sp)
    val mono = TextStyle(color = Tokens.muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)

    /** A figure that is the point of the line it is on: the profile's done and to-come, read at speed. */
    val figure = TextStyle(color = Tokens.ink, fontSize = 12.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
    val label = TextStyle(color = Tokens.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.12.em)
    val number = TextStyle(color = Tokens.ink, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.04).em)
    val unit = TextStyle(color = Tokens.muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
    val axis = TextStyle(color = Tokens.muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    val control = TextStyle(color = Tokens.surface, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
}
