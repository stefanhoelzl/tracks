package net.stho.tracks.ui.map

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant
import kotlinx.coroutines.flow.collectLatest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.ui.resources.Res
import net.stho.tracks.ui.sensors.Fix
import net.stho.tracks.ui.sensors.Heading
import net.stho.tracks.ui.theme.Tokens
import org.maplibre.compose.camera.CameraPosition
import org.maplibre.compose.expressions.dsl.const
import org.maplibre.compose.expressions.dsl.interpolate
import org.maplibre.compose.expressions.dsl.linear
import org.maplibre.compose.expressions.dsl.zoom
import org.maplibre.compose.expressions.value.LineCap
import org.maplibre.compose.expressions.value.LineJoin
import org.maplibre.compose.interaction.ClickResult
import org.maplibre.compose.interaction.MapInteractions
import org.maplibre.compose.layers.LineLayer
import org.maplibre.compose.location.LocationMeasurement
import org.maplibre.compose.location.LocationPuck
import org.maplibre.compose.location.LocationPuckColors
import org.maplibre.compose.map.MapEvent
import org.maplibre.compose.map.MaplibreMap
import org.maplibre.compose.map.rememberMapState
import org.maplibre.compose.overlay.ExpandingAttributionButton
import org.maplibre.compose.sources.GeoJsonData
import org.maplibre.compose.sources.rememberGeoJsonSource
import org.maplibre.compose.style.BaseStyle
import org.maplibre.spatialk.geojson.BoundingBox
import org.maplibre.spatialk.geojson.Position
import org.maplibre.spatialk.units.Bearing
import org.maplibre.spatialk.units.extensions.degrees
import org.maplibre.spatialk.units.extensions.meters

// -------------------------------------------------------------------------------------------------------------------
// The app's map. Nothing in these signatures names a MapLibre type, and nothing outside this package imports one:
// maplibre-compose is pinned and wrapped here so that an upgrade is this package and a deliberate act.
// -------------------------------------------------------------------------------------------------------------------

/**
 * A style the map can draw — the style document itself, as JSON.
 *
 * Offline data (M13) is another way to make one, not another parameter on the map.
 */
class MapStyle(val json: String) {
    companion object {
        /** VersaTiles' `colorful`, washed as the web washes it: `pnpm style:app` writes it with the web's own code. */
        suspend fun colorful(): MapStyle = MapStyle(Res.readBytes("files/colorful.json").decodeToString())
    }
}

sealed interface MapCamera {
    /** Keep the rider centred at [zoom], turned by [orientation]. */
    data class Follow(val orientation: Orientation, val zoom: Double = 15.5) : MapCamera

    /** Fit [points], north-up. */
    data class Overview(val points: List<Coordinate>) : MapCamera
}

/**
 * The map: the basemap, the [plan] line, the rider at [fix], and a camera that does what [camera] says.
 *
 * [onTap] reports where on the map a tap landed. [onIdle] is called whenever the map has finished drawing what it was
 * asked for — what a screenshot waits for.
 */
@Composable
fun TracksMap(
    style: MapStyle,
    camera: MapCamera,
    modifier: Modifier = Modifier,
    plan: List<Coordinate> = emptyList(),
    fix: Fix? = null,
    heading: Heading? = null,
    onTap: (Coordinate) -> Unit = {},
    onIdle: () -> Unit = {},
) {
    // A Metal or Vulkan surface created at 0×0 never recovers (the KRAIL pitfalls): wait for a size, once.
    var sized by remember { mutableStateOf(false) }
    Box(modifier.onSizeChanged { if (it.width > 0 && it.height > 0) sized = true }) {
        if (sized) MapLibreMap(style, camera, plan, fix, heading, onTap, onIdle)
    }
}

/** The plan's weights, from the web's plan-layers.ts: lighter than a selected track, since the plan has no competition. */
private val PLAN_WIDTH = listOf(6 to 2.0, 10 to 2.8, 14 to 3.6)
private val PLAN_CASING_WIDTH = listOf(6 to 3.6, 10 to 4.8, 14 to 6.0)
private const val PLAN_CASING_OPACITY = 0.55f

private fun widthByZoom(stops: List<Pair<Int, Double>>) =
    interpolate(linear(), zoom(), *stops.map { (z, width) -> z to const(width.toFloat().dp) }.toTypedArray())

private fun lineJson(points: List<Coordinate>): String = points.joinToString(
    separator = ",",
    prefix = """{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[""",
    postfix = "]}}",
) { "[${it.lon},${it.lat}]" }

private fun Fix.measurement() = LocationMeasurement(
    position = Position(longitude = at.lon, latitude = at.lat),
    horizontalAccuracy = accuracyM?.meters,
    distancePerSecond = speedMps?.meters,
    course = courseDeg?.let { Bearing.North + it.degrees },
    measuredAt = Instant.fromEpochMilliseconds(epochMillis),
)

private const val FOLLOW_MS = 950L

@Composable
private fun MapLibreMap(
    style: MapStyle,
    camera: MapCamera,
    plan: List<Coordinate>,
    fix: Fix?,
    heading: Heading?,
    onTap: (Coordinate) -> Unit,
    onIdle: () -> Unit,
) {
    val currentCamera by rememberUpdatedState(camera)
    val currentFix by rememberUpdatedState(fix)
    val currentHeading by rememberUpdatedState(heading)
    val currentOnTap by rememberUpdatedState(onTap)
    val currentOnIdle by rememberUpdatedState(onIdle)
    val planJson = remember(plan) { lineJson(plan) }

    // Start where the camera is going when that is known, rather than flying in: every tile a fly-in passes through is
    // one more download, on a phone that may be on a hillside's last bar of signal.
    val initialCamera = remember {
        val at = fix?.at ?: plan.firstOrNull() ?: Coordinate(47.4917, 11.0950)
        when (camera) {
            is MapCamera.Follow -> CameraPosition(
                target = Position(at.lon, at.lat),
                zoom = camera.zoom,
                bearing = mapBearing(camera.orientation, fix, heading, previous = 0.0),
            )
            is MapCamera.Overview -> CameraPosition(target = Position(at.lon, at.lat), zoom = 13.0)
        }
    }

    val state = rememberMapState(
        baseStyle = remember(style) { BaseStyle.Json(style.json) },
        initialCameraPosition = initialCamera,
    ) {
        val planSource = rememberGeoJsonSource(GeoJsonData.JsonString(planJson))
        LineLayer(
            id = "plan-casing",
            source = planSource,
            color = const(Tokens.ink),
            opacity = const(PLAN_CASING_OPACITY),
            width = widthByZoom(PLAN_CASING_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )
        LineLayer(
            id = "plan",
            source = planSource,
            color = const(Tokens.accent),
            width = widthByZoom(PLAN_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )
        // Ink, not accent: the rider sits on the plan line, and an accent dot would vanish into it.
        LocationPuck(
            idPrefix = "rider",
            location = currentFix?.measurement(),
            colors = LocationPuckColors(
                dotFillColorCurrentLocation = Tokens.ink,
                dotFillColorOldLocation = Tokens.muted,
                dotStrokeColor = Color.White,
                accuracyStrokeColor = Color.Transparent,
                accuracyFillColor = Color.Transparent,
                bearingColor = Tokens.ink,
            ),
        )
    }

    LaunchedEffect(state) {
        state.events.collect { if (it == MapEvent.Idle) currentOnIdle() }
    }

    // Exactly one camera effect, keyed on the state, reading its inputs through snapshotFlow: a new fix every second
    // must not cancel and restart the effect, or the camera never finishes an animation.
    LaunchedEffect(state) {
        snapshotFlow { Triple(currentCamera, currentFix, currentHeading) }.collectLatest { (camera, fix, heading) ->
            when (camera) {
                is MapCamera.Follow -> if (fix != null) {
                    val bearing = mapBearing(camera.orientation, fix, heading, previous = state.cameraPosition.bearing)
                    state.animateCameraPosition(
                        CameraPosition(target = Position(fix.at.lon, fix.at.lat), zoom = camera.zoom, bearing = bearing),
                        duration = FOLLOW_MS.milliseconds,
                    )
                }
                is MapCamera.Overview -> if (camera.points.isNotEmpty()) {
                    state.animateCameraToBounds(
                        BoundingBox(
                            west = camera.points.minOf { it.lon },
                            south = camera.points.minOf { it.lat },
                            east = camera.points.maxOf { it.lon },
                            north = camera.points.maxOf { it.lat },
                        ),
                        padding = PaddingValues(32.dp),
                        duration = 600.milliseconds,
                    )
                }
            }
        }
    }

    MaplibreMap(
        state = state,
        interactions = remember {
            MapInteractions {
                callbacks {
                    click {
                        onUnhandled { event ->
                            val at = event.position ?: return@onUnhandled ClickResult.Pass
                            currentOnTap(Coordinate(lat = at.latitude, lon = at.longitude))
                            ClickResult.Consume
                        }
                    }
                }
            }
        },
    ) {
        // Only the attribution OpenStreetMap's licence asks for. The default overlay's logo and compass collide with
        // the app's own controls, and its scale bar is in feet.
        ExpandingAttributionButton()
    }
}
