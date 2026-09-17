package net.stho.tracks.ui.plans

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import net.stho.tracks.ui.offline.PlanOffline
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Tokens

/** The phone full: the one offline state that asks something of the person, in the web's warning amber. */
private val WARNING = Color(0xFFCE7A0C)

/** As tall as the mono numbers it leads. */
private val BADGE = 12.dp

/**
 * Where a plan stands offline, as a small mark and no words, at the start of its numbers: an accent cloud once its map
 * and tiles are all on the phone, a ring that fills while they download, an empty ring while it waits, and an amber
 * ring with a `!` when the phone is too full. What it says is its screen reader description.
 */
@Composable
internal fun OfflineBadge(offline: PlanOffline?, modifier: Modifier = Modifier) {
    val said = offlineOf(offline) ?: return
    if (offline == PlanOffline.Ready) {
        Image(
            Icons.Offline,
            contentDescription = null,
            modifier = modifier.size(BADGE).semantics { contentDescription = said },
            colorFilter = ColorFilter.tint(Tokens.accent),
        )
        return
    }
    Canvas(modifier.size(BADGE).semantics { contentDescription = said }) {
        val stroke = 1.5.dp.toPx()
        val inset = stroke / 2
        val ring = Size(size.width - stroke, size.height - stroke)
        val topLeft = Offset(inset, inset)
        fun ring(colour: Color) = drawArc(colour, 0f, 360f, useCenter = false, topLeft = topLeft, size = ring, style = Stroke(stroke))

        when (offline) {
            is PlanOffline.Downloading -> {
                ring(Tokens.line)
                val sweep = (offline.fraction.coerceIn(0.0, 1.0) * 360).toFloat().coerceAtLeast(8f)
                drawArc(Tokens.accent, -90f, sweep, useCenter = false, topLeft = topLeft, size = ring, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            PlanOffline.Pending -> ring(Tokens.line2)
            PlanOffline.PhoneFull -> {
                ring(WARNING)
                val centre = size.width / 2
                drawLine(WARNING, Offset(centre, size.height * 0.28f), Offset(centre, size.height * 0.55f), stroke, cap = StrokeCap.Round)
                drawCircle(WARNING, stroke * 0.65f, Offset(centre, size.height * 0.72f))
            }
            PlanOffline.Ready, null -> Unit
        }
    }
}
