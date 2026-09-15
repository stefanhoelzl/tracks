package net.stho.tracks.ui.plans

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.legGeometries
import net.stho.tracks.plan.planBounds
import net.stho.tracks.plan.planTotals
import net.stho.tracks.plan.planTrack
import net.stho.tracks.plan.terrainOf
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.ui.map.LegLine
import net.stho.tracks.ui.map.LegState
import net.stho.tracks.ui.map.MapCamera
import net.stho.tracks.ui.map.PlanDrawing
import net.stho.tracks.ui.map.WaypointMark
import net.stho.tracks.ui.map.MapStyle
import net.stho.tracks.ui.map.TracksMap
import net.stho.tracks.ui.sensors.Fix
import net.stho.tracks.ui.theme.IconButton
import net.stho.tracks.ui.theme.Icons
import net.stho.tracks.ui.theme.Pill
import net.stho.tracks.ui.theme.SnapSheet
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/**
 * A stored plan, read-only: the whole of it on the map, and a sheet that is either its name and what can be done with
 * it, or all of it — the numbers and the terrain.
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
    initiallyExpanded: Boolean = false,
    onIdle: () -> Unit = {},
) {
    val plan = stored.plan
    // The plan as the editor draws it — its stops, named, and each leg by its state — with nothing to drag.
    val drawing = remember(stored, routing) {
        PlanDrawing(
            legs = legGeometries(plan.waypoints, stored.legs).mapIndexed { index, line ->
                LegLine(
                    line,
                    when {
                        stored.legs[index] is RoutedLeg -> LegState.Routed
                        routing?.routing == index -> LegState.Routing
                        else -> LegState.Unroutable
                    },
                )
            },
            waypoints = plan.waypoints.map { WaypointMark(Coordinate(it.lat, it.lon), it.kind == WaypointKind.Poi, it.name ?: "") },
            editable = false,
        )
    }
    val frame = remember(stored) {
        planBounds(plan.waypoints, stored.legs)?.let { listOf(Coordinate(it.south, it.west), Coordinate(it.north, it.east)) }
            ?: emptyList()
    }
    var expanded by remember { mutableStateOf(initiallyExpanded) }
    var covered by remember { mutableStateOf(0.dp) }

    Box(modifier.fillMaxSize().background(Tokens.ground)) {
        style?.let {
            TracksMap(
                style = it,
                // Framed clear of the minimised sheet: open, the sheet is the thing being looked at.
                camera = MapCamera.Overview(frame, inset = PaddingValues(start = 32.dp, top = 128.dp, end = 32.dp, bottom = covered + 32.dp)),
                modifier = Modifier.fillMaxSize(),
                drawing = drawing,
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

        SnapSheet(
            expanded = expanded,
            onExpanded = { expanded = it },
            onHeaderHeight = { covered = it },
            header = {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    BasicText(titleOf(plan), style = Type.title)
                    val stops = plan.waypoints.count { it.kind == WaypointKind.Poi }
                    val legs = stored.legs.size
                    BasicText(
                        "$stops stops · $legs ${if (legs == 1) "leg" else "legs"} · brouter · ${plan.profile.label.lowercase()}",
                        style = Type.mono,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(Icons.Edit, "Edit", onClick = onEdit)
                    IconButton(Icons.Copy, "Copy", onClick = onCopy)
                    IconButton(Icons.Share, "Share link", onClick = onShare)
                }
            },
            content = {
                PlanTiles(stored.legs)
                val totals = planTotals(stored.legs)
                terrainOf(planTrack(stored.legs), totals.distanceM.takeIf { it > 0 })?.let { ElevationProfile(it) }
                statusOf(stored, routing)?.let { BasicText(it, style = Type.note) }
            },
        )
    }
}
