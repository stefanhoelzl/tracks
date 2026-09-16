package net.stho.tracks.ui.plans

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Terrain
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** The area under the line, against the line's own colour at full strength. */
private const val AREA_OPACITY = 0.16f

/**
 * A track's terrain against distance, drawn as the web's `ElevationProfile` draws it: coloured by gradient on the
 * absolute ramp, one paint for the line and the area under it, a dropout drawn as a gap, and a y axis at least 200 m
 * tall so a flat valley loop never draws like a col. Two labels on it — the lowest height and the top — and the two
 * ends of the track under it.
 *
 * The plan editor draws it, and the riding panel draws the same thing with you on it: [youM] metres along, a dot on the
 * line and a dashed rule down to the axis.
 */
@Composable
fun ElevationProfile(terrain: Terrain, modifier: Modifier = Modifier, height: Dp = 96.dp, youM: Double? = null) {
    val stops = remember(terrain) { terrain.rampStops() }
    val floorM = terrain.floorM
    val topM = terrain.topM

    Column(modifier) {
        Box(Modifier.fillMaxWidth().height(height)) {
            Canvas(Modifier.fillMaxWidth().height(height).padding(start = 34.dp, end = 8.dp, top = 8.dp, bottom = 6.dp)) {
                val width = size.width
                val plot = size.height
                fun x(distance: Double) = (distance / terrain.totalM * width).toFloat()
                fun y(altitude: Double) = (plot - (altitude - floorM) / (topM - floorM) * plot).toFloat()

                val measured = terrain.altitudeM.indices.filter { terrain.altitudeM[it] != null }
                val brush = if (stops == null || measured.isEmpty()) {
                    SolidColor(Tokens.ink2)
                } else {
                    Brush.horizontalGradient(
                        *stops.map { (offset, colour) ->
                            offset.toFloat() to (colour?.let { Color(0xFF000000L or it.toLong()) } ?: Tokens.ink2)
                        }.toTypedArray(),
                        startX = x(terrain.distances[measured.first()]),
                        endX = x(terrain.distances[measured.last()]),
                    )
                }

                // One run per stretch of measured altitude: a dropout is a gap, never a line across it.
                var start = 0
                while (start < terrain.altitudeM.size) {
                    if (terrain.altitudeM[start] == null) {
                        start++
                        continue
                    }
                    var end = start
                    while (end + 1 < terrain.altitudeM.size && terrain.altitudeM[end + 1] != null) end++

                    val line = Path()
                    val area = Path()
                    for (at in start..end) {
                        val px = x(terrain.distances[at])
                        val py = y(terrain.altitudeM[at]!!)
                        if (at == start) {
                            line.moveTo(px, py)
                            area.moveTo(px, plot)
                            area.lineTo(px, py)
                        } else {
                            line.lineTo(px, py)
                            area.lineTo(px, py)
                        }
                    }
                    area.lineTo(x(terrain.distances[end]), plot)
                    area.close()

                    drawPath(area, brush, alpha = AREA_OPACITY)
                    drawPath(line, brush, style = Stroke(width = 1.2.dp.toPx()))
                    start = end + 1
                }

                youM?.let { along ->
                    val px = x(along.coerceIn(0.0, terrain.totalM))
                    drawLine(
                        Tokens.ink,
                        Offset(px, 0f),
                        Offset(px, plot),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx())),
                    )
                    altitudeAlong(terrain, along)?.let { altitude ->
                        drawCircle(Color.White, radius = 5.5.dp.toPx(), center = Offset(px, y(altitude)))
                        drawCircle(Tokens.ink, radius = 4.dp.toPx(), center = Offset(px, y(altitude)))
                    }
                }
            }
            BasicText(Format.metres(topM), style = Type.axis, modifier = Modifier.align(Alignment.TopStart))
            BasicText(Format.metres(floorM), style = Type.axis, modifier = Modifier.align(Alignment.BottomStart))
        }
        Row(Modifier.fillMaxWidth().padding(start = 34.dp, end = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText("0", style = Type.axis)
            BasicText("${Format.km(terrain.totalM)} km", style = Type.axis)
        }
    }
}

/** The height [alongM] metres along, between the drawn points either side; null in a dropout. */
private fun altitudeAlong(terrain: Terrain, alongM: Double): Double? {
    val after = terrain.distances.indexOfFirst { it >= alongM }
    if (after < 0) return terrain.altitudeM.lastOrNull()
    if (after == 0) return terrain.altitudeM.first()
    val a = terrain.altitudeM[after - 1] ?: return null
    val b = terrain.altitudeM[after] ?: return null
    val span = terrain.distances[after] - terrain.distances[after - 1]
    return if (span <= 0) b else a + (alongM - terrain.distances[after - 1]) / span * (b - a)
}
