package net.stho.tracks.ui.plans

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.legGeometries
import net.stho.tracks.plan.planBounds
import net.stho.tracks.plan.planTotals
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.ui.sensors.Fix
import net.stho.tracks.ui.theme.Pill
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.StatTile
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/**
 * A stored plan, read-only: the whole of it on the map, its numbers, and what can be done with it.
 *
 * What a tap in the list opens until riding exists (M14), when that tap starts a ride instead.
 */
@Composable
fun PlanPreview(
    style: MapStyle?,
    stored: StoredPlan,
    routing: PlanRouting?,
    fix: Fix?,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    modifier: Modifier = Modifier,
    onIdle: () -> Unit = {},
) {
    val plan = stored.plan
    // Every leg as it is drawn, routed or not: a leg with no answer yet is the straight run through its waypoints.
    val line = remember(stored) { legGeometries(plan.waypoints, stored.legs).flatten() }
    val frame = remember(stored) {
        planBounds(plan.waypoints, stored.legs)?.let { listOf(Coordinate(it.south, it.west), Coordinate(it.north, it.east)) }
            ?: emptyList()
    }
    var panelHeight by remember { mutableIntStateOf(0) }
    val panelDp = with(LocalDensity.current) { panelHeight.toDp() }

    Box(modifier.fillMaxSize().background(Tokens.ground)) {
        style?.let {
            TracksMap(
                style = it,
                camera = MapCamera.Overview(frame, inset = PaddingValues(start = 32.dp, top = 128.dp, end = 32.dp, bottom = panelDp + 32.dp)),
                modifier = Modifier.fillMaxSize(),
                plan = line,
                fix = fix,
                onIdle = onIdle,
            )
        }

        Pill(
            "‹ Plans",
            onClick = onBack,
            primary = false,
            // Under the map's attribution, which holds the top edge.
            modifier = Modifier.align(Alignment.TopStart).windowInsetsPadding(WindowInsets.safeDrawing).padding(start = 16.dp, top = 64.dp),
        )

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { panelHeight = it.height }
                .background(Tokens.glassHi, Shapes.sheet)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                BasicText(titleOf(plan), style = Type.title)
                val stops = plan.waypoints.count { it.kind == WaypointKind.Poi }
                val legs = stored.legs.size
                BasicText(
                    "$stops stops · $legs ${if (legs == 1) "leg" else "legs"} · brouter · ${plan.profile.label.lowercase()}",
                    style = Type.mono,
                )
            }

            PlanTiles(stored.legs)

            statusOf(stored, routing)?.let { BasicText(it, style = Type.note) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("Edit", onClick = onEdit, primary = false)
                Pill("Copy", onClick = onCopy, primary = false)
                Pill("Share link", onClick = onShare)
            }
        }
    }
}
