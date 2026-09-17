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

    val Navigate: ImageVector = lucide("navigation", "M3 11l19-9-9 19-2-8-8-2z")

    /** North up: a compass whose needle points north, its north half filled. */
    val NorthUp: ImageVector = ImageVector.Builder(name = "compass-north", defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(addPathNodes("M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0z"), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 2f)
        .addPath(addPathNodes("M12 4.5L15 12H9z"), fill = SolidColor(Color.Black))
        .addPath(addPathNodes("M12 19.5L9 12h6z"), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.6f, strokeLineJoin = StrokeJoin.Round)
        .build()

    /** The map left where a finger put it: a tap follows you again. */
    val Locate: ImageVector = lucide(
        "locate-fixed",
        "M2 12h3",
        "M19 12h3",
        "M12 2v3",
        "M12 19v3",
        "M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0z",
        "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
    )

    // Circular, not hooked: a hooked arrow pointing left, top left over a map, reads as Back.
    val Undo: ImageVector = lucide("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val Redo: ImageVector = lucide("rotate-cw", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5")

    // A ride's controls, behind its ⋯.
    val Pause: ImageVector = lucide(
        "pause",
        "M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
        "M6 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    )
    val Resume: ImageVector = lucide("play", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z")
    val StopRide: ImageVector = lucide("square", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z")
    val New: ImageVector = lucide("plus", "M5 12h14", "M12 5v14")
    val Close: ImageVector = lucide("x", "M18 6L6 18", "M6 6l12 12")
    val Save: ImageVector = lucide("check", "M20 6L9 17l-5-5")
    val Back: ImageVector = lucide("chevron-left", "M15 18l-6-6 6-6")

    /** A plan all on the phone: what the list marks it with, in the accent. */
    val Offline: ImageVector = lucide(
        "cloud-download",
        "M12 13v8",
        "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
        "M8 17l4 4 4-4",
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

    // The sports on the Save sheet: Phosphor's person-simple figures (regular weight, MIT), since lucide draws no hiker
    // and no runner. Filled outlines on a 256-unit grid, where lucide's are strokes on 24.
    val Bike: ImageVector = phosphor(
        "person-simple-bike",
        "M164,80a28,28,0,1,0-28-28A28,28,0,0,0,164,80Zm0-40a12,12,0,1,1-12,12A12,12,0,0,1,164,40Zm36,96a40,40,0,1,0,40,40A40,40,0,0,0,200,136Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,200,200ZM56,136a40,40,0,1,0,40,40A40,40,0,0,0,56,136Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,56,200Zm136-80H152a8,8,0,0,1-5.66-2.34L120,91.31,99.31,112l34.35,34.34A8,8,0,0,1,136,152v48a8,8,0,0,1-16,0V155.31L82.34,117.66a8,8,0,0,1,0-11.32l32-32a8,8,0,0,1,11.32,0L155.31,104H192a8,8,0,0,1,0,16Z",
    )
    val Hike: ImageVector = phosphor(
        "person-simple-hike",
        "M152,80a32,32,0,1,0-32-32A32,32,0,0,0,152,80Zm0-48a16,16,0,1,1-16,16A16,16,0,0,1,152,32Zm48,112v88a8,8,0,0,1-16,0V151.66c-25.75-2.25-34.35-15.52-42-27.36-2.85-4.39-5.56-8.57-9.13-12.19l-13.4,30.81,37.2,26.57A8,8,0,0,1,160,176v56a8,8,0,0,1-16,0V180.12l-31.07-22.2L79.34,235.19A8,8,0,0,1,72,240a7.84,7.84,0,0,1-3.19-.67,8,8,0,0,1-4.14-10.52L122.19,96.5a8,8,0,0,1,11-3.92,40.92,40.92,0,0,1,8,5.47c6.37,5.52,10.51,11.91,14.16,17.55,7.68,11.84,13.22,20.4,36.6,20.4A8,8,0,0,1,200,144ZM72,152a8,8,0,0,0,7.35-4.85l24-56a8,8,0,0,0-4.2-10.5l-28-12a8,8,0,0,0-10.5,4.2l-24,56a8,8,0,0,0,4.2,10.5l28,12A8,8,0,0,0,72,152ZM54.51,127.8,72.2,86.5l13.3,5.7L67.8,133.49Z",
    )
    val Run: ImageVector = phosphor(
        "person-simple-run",
        "M152,88a32,32,0,1,0-32-32A32,32,0,0,0,152,88Zm0-48a16,16,0,1,1-16,16A16,16,0,0,1,152,40Zm67.31,100.68c-.61.28-7.49,3.28-19.67,3.28-13.85,0-34.55-3.88-60.69-20a169.31,169.31,0,0,1-15.41,32.34,104.29,104.29,0,0,1,31.31,15.81C173.92,186.65,184,207.35,184,232a8,8,0,0,1-16,0c0-41.7-34.69-56.71-54.14-61.85-.55.7-1.12,1.41-1.69,2.1-19.64,23.8-44.25,36.18-71.63,36.18A92.29,92.29,0,0,1,31.2,208,8,8,0,0,1,32.8,192c25.92,2.58,48.47-7.49,67-30,12.49-15.14,21-33.61,25.25-47C86.13,92.35,61.27,111.63,61,111.84A8,8,0,1,1,51,99.36c1.5-1.2,37.22-29,89.51,6.57,45.47,30.91,71.93,20.31,72.18,20.19a8,8,0,1,1,6.63,14.56Z",
    )

    private fun phosphor(name: String, path: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 256f, viewportHeight = 256f)
            .apply { addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black)) }
            .build()

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
