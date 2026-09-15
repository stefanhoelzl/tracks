package net.stho.tracks.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The web's tokens (packages/web/src/styles/tokens.css), as far as the phone draws them.
 *
 * Each value names the custom property it mirrors, and `app-tokens.test.ts` holds the two to each other: a colour
 * changed on the web fails the TypeScript suite until it is changed here too.
 *
 * Light only. The web has no dark theme to mirror, and a dark palette — and a dark wash of the basemap — is a
 * design of its own, not a translation.
 */
object Tokens {
    val ground = Color(0xFFEEF1EE) // --ground
    val surface = Color(0xFFFFFFFF) // --surface
    val glass = Color(0xD1FFFFFF) // --glass
    val glassHi = Color(0xEBFFFFFF) // --glass-hi
    val sunk = Color(0xFFF1F4F1) // --sunk

    val ink = Color(0xFF0F1513) // --ink
    val ink2 = Color(0xFF3E4945) // --ink-2
    val muted = Color(0xFF77837E) // --muted

    val line = Color(0xFFE5E9E5) // --line
    val line2 = Color(0xFFD3DAD5) // --line-2

    /** Interactive state, never data: a plan line is accent because it is the thing you edit. */
    val accent = Color(0xFF0D8A5F) // --accent
    val accentDeep = Color(0xFF0A6E4C) // --accent-deep
    val accentSoft = Color(0xFFE4F3EC) // --accent-soft
}
