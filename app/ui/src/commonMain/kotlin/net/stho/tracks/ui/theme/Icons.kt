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

/** A round button with an icon on it: accent for the thing to do. [label] is what a screen reader says. */
@Composable
fun IconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(44.dp)
            .background(Tokens.accent, CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = null, modifier = Modifier.size(20.dp), colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(Tokens.surface))
    }
}
