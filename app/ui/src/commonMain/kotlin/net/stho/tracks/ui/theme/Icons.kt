package net.stho.tracks.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * The few icons the phone draws, as the web draws them: lucide's outlines on a 24-unit grid, stroked at 2 with round
 * ends. Drawn from their path data rather than bundled as images, so they take any colour and stay sharp.
 */
object Icons {
    val Share: ImageVector = lucide("share", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "M16 6l-4-4-4 4", "M12 2v13")
    val Edit: ImageVector = lucide(
        "pencil",
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
        "M15 5l4 4",
    )
    val Copy: ImageVector = lucide(
        "copy",
        "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
        "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
    )

    val Ride: ImageVector = lucide(
        "bike",
        "M22 17.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z",
        "M9 17.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z",
        "M16 5a1 1 0 1 1-2 0a1 1 0 1 1 2 0z",
        "M12 17.5V14l-3-3 4-3 2 3h2",
    )
    val Undo: ImageVector = lucide("undo-2", "M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11")
    val Redo: ImageVector = lucide("redo-2", "M15 14l5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13")
    val Close: ImageVector = lucide("x", "M18 6L6 18", "M6 6l12 12")
    val Save: ImageVector = lucide("check", "M20 6L9 17l-5-5")
    val Paste: ImageVector = lucide(
        "clipboard-paste",
        "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
        "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113",
        "M16 4h2a2 2 0 0 1 2 2v1.344",
        "M11 14h10",
        "M17 10l4 4-4 4",
    )

    val Delete: ImageVector = lucide(
        "trash-2",
        "M3 6h18",
        "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
        "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
        "M10 11v6",
        "M14 11v6",
    )

    // The waypoint dialog's: where a stop goes, and what a waypoint is.
    val Add: ImageVector = lucide("plus", "M5 12h14", "M12 5v14")
    val Start: ImageVector = lucide("arrow-left-to-line", "M3 19V5", "M13 6l-6 6 6 6", "M7 12h14")
    val End: ImageVector = lucide("arrow-right-to-line", "M17 12H3", "M11 18l6-6-6-6", "M21 5v14")
    val Insert: ImageVector = lucide("git-commit-horizontal", "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z", "M3 12h6", "M15 12h6")
    val Shaping: ImageVector = lucide(
        "spline",
        "M21 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0z",
        "M7 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0z",
        "M5 17A12 12 0 0 1 17 5",
    )
    val Stop: ImageVector = lucide(
        "map-pin",
        "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
        "M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
    )

    private fun lucide(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply {
                for (path in paths) {
                    addPath(
                        pathData = addPathNodes(path),
                        fill = null,
                        stroke = SolidColor(Color.Black),
                        strokeLineWidth = 2f,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }
            }
            .build()
}

/**
 * A round button with an icon on it and no word: accent for the thing to do, a grey disc for the rest. [label] is what
 * a screen reader says.
 */
@Composable
fun IconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = true) {
    Box(
        modifier
            .size(44.dp)
            .background(if (primary) Tokens.accent else Tokens.sunk, CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = null, modifier = Modifier.size(20.dp), colorFilter = ColorFilter.tint(if (primary) Tokens.surface else Tokens.ink))
    }
}
