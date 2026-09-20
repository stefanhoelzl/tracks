package net.stho.tracks.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
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
 * The few icons the phone draws, as the web draws them: lucide's outlines on a 24-unit grid,
 * stroked at [STROKE] with round ends. Drawn from their path data rather than bundled as images, so
 * they take any colour and stay sharp.
 *
 * **Nothing is drawn behind an icon** — no disc, no glass, no halo. What used to be a 44 dp accent
 * disc is now a bare stroke over whatever is under it; the 44 dp target stays, invisible.
 *
 * **Colour is meaning, and green is also the primary.** Green is what goes forward and what you
 * came to press — redo, save, add, stop the ride, a camera that is following you. Red is what takes
 * something away — undo, discard, delete. Black is everything neutral.
 *
 * **Undo and Redo, which float on the map, are drawn inside a circle** ([circled]): that circle is the
 * glyph and takes the icon's colour, and it is not the disc that went. An icon inside a sheet is bare.
 * The camera is the exception on both counts — see it below.
 *
 * The sports are the one thing not from lucide, which draws no hiker and no runner: they are
 * Phosphor's `person-simple-*` at **bold**, whose 24/256 stroke is 2.25 on this grid and so matches
 * everything else. Phosphor's regular weight is the same outline drawing at 16/256 — 1.5 here, a
 * hairline beside the rest — which is why the weight moved rather than the family.
 */
object Icons {
    /** Every stroke on the 24-unit grid, including the circle a map control is framed in. */
    const val STROKE = 2.2f

    /** How much of the frame a circled glyph fills. Its stroke is scaled back up, so it draws at [STROKE]. */
    private const val INSET = 0.56f

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

    /** The arrow itself, bare: *Ride* on home, and *Navigate* in a menu. Circled, it is [HeadingUp]. */
    val Navigate: ImageVector = lucide("navigation", "M3 11l19-9-9 19-2-8-8-2z")

    // The camera's three states are two glyphs, and they are the one place in this set that is **solid, and carries
    // no circle**. A needle and an arrow are shapes rather than outlines of shapes: stroked, they read as small empty
    // triangles, and framed in a circle they read as a button rather than as a direction. Colour still carries the
    // state — black while the map is yours to pan, green once it is following you.
    /**
     * A compass needle, filled: manual in black, north-up in green.
     *
     * One diamond, not two crossed ones — a needle with an east-west bar through it is a sparkle at 24 dp, which is
     * what the first attempt drew.
     */
    val Compass: ImageVector = filled("compass-needle", "M12 2.2L16 12 12 21.8 8 12z")

    /** lucide `navigation`, filled: the map turning with you. */
    val HeadingUp: ImageVector = filled("heading-up", "M3 11l19-9-9 19-2-8-8-2z")

    // lucide's `rotate-ccw` is itself a circular arrow, and a circle inside a circle is two circles;
    // `undo-2` is the same idea as a hooked arrow, which sits inside the frame.
    val Undo: ImageVector = circled(
        "undo-2",
        "M9 14L4 9l5-5",
        "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",
    )
    val Redo: ImageVector = circled(
        "redo-2",
        "M15 14l5-5-5-5",
        "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13",
    )

    // A ride's controls, behind its ⋯.
    val Pause: ImageVector = lucide("pause", "M15 4h4v16h-4z", "M5 4h4v16H5z")
    val Resume: ImageVector = lucide("play", "M6 4l14 8-14 8z")
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

    // What a waypoint is, as four marks rather than four words: a dot the line leaves, a dot it
    // arrives at, a dot it passes through, and two dots with a bend between them. They are the type
    // buttons in the dialog and the first thing in every row of a stop list — on both the phone and
    // the web. The markers on the map are unchanged; a glyph the size of a stop would be a worse pin.
    /** `o->` — the line leaves here. */
    val Start: ImageVector = lucide("waypoint-start", dot(5f, 3f), "M8.2 12h10.6", "M15 8l4 4-4 4")

    /** `->o` — the line arrives here. */
    val End: ImageVector = lucide("waypoint-end", "M2 12h10.4", "M9 8l4 4-4 4", dot(19f, 3f))

    /** `-o-` — the line passes through, and you stop. */
    val Mid: ImageVector = lucide("waypoint-mid", "M2 12h6.2", dot(12f, 3f), "M15.8 12H22")

    /** `o⌒o` — a bend in a leg, stopping at neither end of it. */
    val Shaping: ImageVector = lucide(
        "waypoint-shape",
        dot(4.6f, 2.6f, cy = 17.4f),
        dot(19.4f, 2.6f, cy = 17.4f),
        "M6.6 15.6C8.6 6.6 15.4 6.6 17.4 15.6",
    )

    // The sports on the Save sheet: Phosphor's person-simple figures at bold (MIT), since lucide
    // draws no hiker and no runner. Outlines on a 256-unit grid drawn as filled paths, where
    // lucide's are strokes on 24 — the same drawing, expressed the other way round.
    val Bike: ImageVector = phosphor(
        "person-simple-bike-bold",
        "M168,84a32,32,0,1,0-32-32A32,32,0,0,0,168,84Zm0-40a8,8,0,1,1-8,8A8,8,0,0,1,168,44Zm36,96a40,40,0,1,0,40,40A40,40,0,0,0,204,140Zm0,56a16,16,0,1,1,16-16A16,16,0,0,1,204,196ZM54,136a42,42,0,1,0,42,42A42,42,0,0,0,54,136Zm0,60a18,18,0,1,1,18-18A18,18,0,0,1,54,196Zm138-84H153a12,12,0,0,1-8.49-3.51L120,84,103,101l32.49,32.51A12,12,0,0,1,139,142v50a12,12,0,0,1-24,0V147l-35.49-35.5a12,12,0,0,1,0-17l34-34a12,12,0,0,1,17,0L158,88h34a12,12,0,0,1,0,24Z",
    )
    val Hike: ImageVector = phosphor(
        "person-simple-hike-bold",
        "M152,84a36,36,0,1,0-36-36A36,36,0,0,0,152,84Zm0-48a12,12,0,1,1-12,12A12,12,0,0,1,152,36Zm52,108v88a12,12,0,0,1-24,0V155.24c-24.92-3.37-33.94-17.29-41.38-28.76-1.55-2.39-3.05-4.71-4.67-6.88l-9.54,22L159,166.23a12,12,0,0,1,5,9.77v56a12,12,0,0,1-24,0V182.18l-25.1-17.93L82.37,239.92a12,12,0,0,1-22-9.84L118.61,95.76a12,12,0,0,1,16.36-5.94,44.85,44.85,0,0,1,8.85,6.05c7,6.06,11.52,13,15.39,19,7,10.72,11.2,17.19,29.79,17.19A12,12,0,0,1,204,144ZM72,156a12,12,0,0,0,11-7.27l24-56a12,12,0,0,0-6.3-15.75l-28-12a12,12,0,0,0-15.75,6.3l-24,56a12,12,0,0,0,6.3,15.75l28,12A12,12,0,0,0,72,156ZM60.4,124.88,74.55,91.85l6,2.56L66.4,127.44Z",
    )
    val Run: ImageVector = phosphor(
        "person-simple-run-bold",
        "M152,92a36,36,0,1,0-36-36A36,36,0,0,0,152,92Zm0-48a12,12,0,1,1-12,12A12,12,0,0,1,152,44Zm76,93.4a12,12,0,0,1-7,10.91,66,66,0,0,1-21.47,3.78c-14,0-34.25-3.82-59.77-19a177,177,0,0,1-10.27,21C153.12,162.83,188,182.6,188,232a12,12,0,0,1-24,0c0-34.37-27-47.69-44.34-52.87-19.94,23.19-45.11,35.2-72.84,35.2a96.31,96.31,0,0,1-16.83-1.43,12,12,0,0,1,4.22-23.62c24.41,2.43,45.35-7.16,62.78-28.36,10-12.11,17.2-26.48,21.53-38.11C93.78,101.18,72,113.9,68.49,116.72a12,12,0,1,1-15-18.72c1.79-1.43,40.44-31.34,95.75,6.28,41.14,28,64.11,19.57,64.34,19.48a12,12,0,0,1,14.4,13.64Z",
    )

    /** A circle of radius [r] at ([cx], [cy]), in the two-arc shape lucide writes one with. */
    private fun dot(cx: Float, r: Float, cy: Float = 12f): String =
        "M${cx + r} ${cy}a$r $r 0 1 0 -${r * 2} 0a$r $r 0 1 0 ${r * 2} 0"

    /** Solid shapes on the 24 grid: the camera's needle and its arrow, which are directions rather than outlines. */
    private fun filled(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply { paths.forEach { addPath(pathData = addPathNodes(it), fill = SolidColor(Color.Black)) } }
            .build()

    private fun phosphor(name: String, path: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 256f, viewportHeight = 256f)
            .apply { addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black)) }
            .build()

    private fun lucide(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply { paths.forEach { stroke(it, STROKE) } }
            .build()

    /**
     * [paths] shrunk to [inset] of the frame and set inside a drawn circle: what a control floating
     * on the map looks like.
     *
     * The group scales about the centre, which scales the stroke with it, so the inner stroke is set
     * to [STROKE] divided by the scale and comes out at [STROKE] like every other line.
     */
    private fun circled(name: String, vararg paths: String, inset: Float = INSET): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply {
                stroke(CIRCLE_10, STROKE)
                addGroup(name = "$name-inner", pivotX = 12f, pivotY = 12f, scaleX = inset, scaleY = inset)
                paths.forEach { stroke(it, STROKE / inset) }
                clearGroup()
            }
            .build()

    private fun ImageVector.Builder.stroke(path: String, width: Float) {
        addPath(
            pathData = addPathNodes(path),
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = width,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
}

/** The frame a map control is drawn in, and lucide's own compass rim. */
private const val CIRCLE_10 = "M22 12a10 10 0 1 0 -20 0a10 10 0 1 0 20 0"

/**
 * An icon with no word and nothing behind it. [label] is what a screen reader says, [tint] what the
 * icon means: [Tokens.accent] for what goes forward or is the thing to press, [Tokens.bad] for what
 * takes something away, [Tokens.ink] for the rest.
 *
 * The box stays 44 dp so a glove finds it; only the drawing shrank.
 */
@Composable
fun IconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Tokens.ink) {
    Box(
        modifier
            .size(44.dp)
            .clickable(onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = null, modifier = Modifier.size(24.dp), colorFilter = ColorFilter.tint(tint))
    }
}
