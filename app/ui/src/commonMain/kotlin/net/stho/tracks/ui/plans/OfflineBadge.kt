package net.stho.tracks.ui.plans

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import net.stho.tracks.ui.offline.PlanOffline
import net.stho.tracks.ui.theme.Tokens

/** The phone full: the one offline state that asks something of the person, in the web's warning amber. */
private val WARNING = Color(0xFFCE7A0C)

/**
 * Where a plan stands offline, as a mark and no words: a ring that fills while its map and tiles download, a filled
 * accent disc with a check once it is all on the phone, an empty ring while it waits, and a warning when the phone is too
 * full. What it says is its screen reader description.
 */
@Composable
internal fun OfflineBadge(offline: PlanOffline?, modifier: Modifier = Modifier) {
    val said = offlineOf(offline) ?: return
    Canvas(modifier.size(20.dp).semantics { contentDescription = said }) {
        val stroke = 2.dp.toPx()
        val inset = stroke / 2
        val ring = Size(size.width - stroke, size.height - stroke)
        val topLeft = Offset(inset, inset)
        fun track() = drawArc(Tokens.line, 0f, 360f, useCenter = false, topLeft = topLeft, size = ring, style = Stroke(stroke))

        when (offline) {
            PlanOffline.Ready -> {
                drawCircle(Tokens.accent)
                val check = Path().apply {
                    moveTo(size.width * 0.28f, size.height * 0.52f)
                    lineTo(size.width * 0.44f, size.height * 0.68f)
                    lineTo(size.width * 0.73f, size.height * 0.36f)
                }
                drawPath(check, Tokens.surface, style = Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            is PlanOffline.Downloading -> {
                track()
                val sweep = (offline.fraction.coerceIn(0.0, 1.0) * 360).toFloat().coerceAtLeast(8f)
                drawArc(Tokens.accent, -90f, sweep, useCenter = false, topLeft = topLeft, size = ring, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            PlanOffline.Pending -> track()
            PlanOffline.PhoneFull -> {
                val w = size.width
                val h = size.height
                val triangle = Path().apply {
                    moveTo(w * 0.5f, inset)
                    lineTo(w - inset, h - inset)
                    lineTo(inset, h - inset)
                    close()
                }
                drawPath(triangle, WARNING, style = Stroke(stroke, join = StrokeJoin.Round))
                drawLine(WARNING, Offset(w * 0.5f, h * 0.38f), Offset(w * 0.5f, h * 0.62f), stroke, cap = StrokeCap.Round)
                drawCircle(WARNING, stroke * 0.6f, Offset(w * 0.5f, h * 0.78f))
            }
            null -> Unit
        }
    }
}
