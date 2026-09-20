package net.stho.tracks.ui.map

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.DpRect
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.ui.resources.Res
import net.stho.tracks.ui.theme.Tokens
import org.maplibre.compose.camera.CameraPosition
import org.maplibre.compose.expressions.dsl.asString
import org.maplibre.compose.expressions.dsl.const
import org.maplibre.compose.expressions.dsl.feature
import org.maplibre.compose.expressions.dsl.format
import org.maplibre.compose.expressions.dsl.image
import org.maplibre.compose.expressions.dsl.interpolate
import org.maplibre.compose.expressions.dsl.linear
import org.maplibre.compose.expressions.dsl.span
import org.maplibre.compose.expressions.dsl.textOffset
import org.maplibre.compose.expressions.dsl.zoom
import org.maplibre.compose.expressions.value.IconRotationAlignment
import org.maplibre.compose.expressions.value.LineCap
import org.maplibre.compose.expressions.value.LineJoin
import org.maplibre.compose.expressions.value.SymbolAnchor
import org.maplibre.compose.interaction.ClickResult
import org.maplibre.compose.interaction.MapInteractions
import org.maplibre.compose.layers.CircleLayer
import org.maplibre.compose.layers.LineLayer
import org.maplibre.compose.layers.SymbolLayer
import org.maplibre.compose.location.LocationMeasurement
import org.maplibre.compose.location.LocationPuck
import org.maplibre.compose.location.LocationPuckColors
import org.maplibre.compose.map.MapEvent
import org.maplibre.compose.map.MapState
import org.maplibre.compose.map.MaplibreMap
import org.maplibre.compose.map.rememberMapState
import org.maplibre.compose.sources.GeoJsonData
import org.maplibre.compose.sources.rememberGeoJsonSource
import org.maplibre.compose.style.BaseStyle
import org.maplibre.compose.style.TransitionOptions
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
    /**
     * Keep the rider centred at [zoom], turned by [orientation] — centred in what [inset] leaves of the map. Every move
     * goes back to [zoom]: a pinch is a gesture, and a gesture leaves following for [Free].
     */
    data class Follow(
        val orientation: Orientation,
        val zoom: Double = 15.5,
        val inset: PaddingValues = PaddingValues(0.dp),
    ) : MapCamera

    /**
     * Centre on the rider's first fix at [zoom], in what [inset] leaves of the map, and then leave the map to the
     * person using it: a map that re-centres every second cannot be panned or zoomed.
     */
    data class Centre(val zoom: Double = 13.0, val inset: PaddingValues = PaddingValues(0.dp)) : MapCamera

    /** Wherever the person using the map has put it: nothing moves the camera until another camera is asked for. */
    data object Free : MapCamera

    /** [at] brought to the middle of what [inset] leaves, as the map is zoomed and turned, and then left as [Free] is. */
    data class Show(val at: Coordinate, val inset: PaddingValues = PaddingValues(0.dp)) : MapCamera

    /** Fit [points], north-up, clear of [inset] — whatever is drawn over the map's edges. */
    data class Overview(val points: List<Coordinate>, val inset: PaddingValues = PaddingValues(32.dp)) : MapCamera
}

/** How a leg is drawn, from plan-layers.ts: one dash pattern, one meaning — *this is a straight line, not a route*. */
enum class LegState {
    Routed,

    /** Not a route yet: the dash in the plan's colour, pulsing while the engine works. */
    Routing,

    /** Not a route, and not being made one: a still dash — could not be routed, no data here, or a drag in progress. */
    Unroutable,
}

data class LegLine(val coordinates: List<Coordinate>, val state: LegState)

/** A waypoint on the map: a stop, labelled with its name, or a shaping point on the line. */
data class WaypointMark(val at: Coordinate, val stop: Boolean, val label: String)

/**
 * A plan with its legs and waypoints. [pulse] animates routing legs; the screenshot scenes hold them still. Only an
 * [editable] one has waypoints that can be tapped and dragged.
 */
data class PlanDrawing(
    val legs: List<LegLine>,
    val waypoints: List<WaypointMark>,
    val pulse: Boolean = true,
    val editable: Boolean = true,
)

/**
 * The map: the basemap, the [plan] line (or a [drawing] of one being edited), the rider at [fix], and a camera that
 * does what [camera] says.
 *
 * [onTap] reports where a tap landed. With [onPlace] set, a tap instead reports where it landed together with the name
 * of the place labelled under it on the map — how a stop is named with no signal. [onLongPress] reports a long press;
 * [onLongPlace], set instead, reports one with the name of the place under it.
 * A [drawing]'s waypoints can be tapped ([onWaypointTap]) and, once a long press picks one up, dragged ([onWaypointDrag],
 * reported as they move and once more, `done`, where they are let go). [onIdle] is called whenever the map has finished
 * drawing what it was asked for — what a screenshot waits for. [onGesture] is called when a finger pans, pinches or turns
 * the map — not for a tap or a long press — for a screen to stop moving the camera itself. [marker] is a place picked
 * off the map, drawn as a ring. [highlight] is a stretch selected on the elevation profile: the rest of the line is
 * held back and this piece keeps its colour, so the chart and the map are talking about the same kilometres.
 */
@Composable
fun TracksMap(
    style: MapStyle,
    camera: MapCamera,
    modifier: Modifier = Modifier,
    plan: List<Coordinate> = emptyList(),
    ridden: List<Coordinate> = emptyList(),
    fix: Fix? = null,
    heading: Heading? = null,
    drawing: PlanDrawing? = null,
    onTap: (Coordinate) -> Unit = {},
    onPlace: ((Coordinate, String?) -> Unit)? = null,
    onLongPress: ((Coordinate) -> Unit)? = null,
    onLongPlace: ((Coordinate, String?) -> Unit)? = null,
    onWaypointTap: (Int) -> Unit = {},
    onWaypointDrag: (index: Int, at: Coordinate, done: Boolean) -> Unit = { _, _, _ -> },
    onGesture: () -> Unit = {},
    marker: Coordinate? = null,
    highlight: List<Coordinate> = emptyList(),
    /** Whether [highlight] is a stretch of the ride rather than of the plan: it then wears the ride's colour. */
    highlightRidden: Boolean = false,
    onIdle: () -> Unit = {},
) {
    // A Metal or Vulkan surface created at 0×0 never recovers (the KRAIL pitfalls): wait for a size, once.
    var sized by remember { mutableStateOf(false) }
    Box(modifier.onSizeChanged { if (it.width > 0 && it.height > 0) sized = true }) {
        if (sized) {
            MapLibreMap(style, camera, plan, ridden, fix, heading, drawing, onTap, onPlace, onLongPress, onLongPlace, onWaypointTap, onWaypointDrag, onGesture, marker, highlight, highlightRidden, onIdle)
        }
    }
}

/** The plan's weights, from the web's plan-layers.ts: lighter than a selected track, since the plan has no competition. */
private val PLAN_WIDTH = listOf(6 to 2.0, 10 to 2.8, 14 to 3.6)
private val PLAN_CASING_WIDTH = listOf(6 to 3.6, 10 to 4.8, 14 to 6.0)
private const val PLAN_CASING_OPACITY = 0.55f

/** What the plan line drops to outside a stretch selected on the profile. The stretch keeps its colour. */
private const val HELD_BACK = 0.28f

/** The white border around that stretch: wider than the plan's own casing, so it reads as picked out of the line. */
private val HIGHLIGHT_CASING_WIDTH = listOf(6 to 5.6, 10 to 7.4, 14 to 9.2)

/**
 * The track being recorded: the web palette's second hue (lib/colour.ts), not the accent. The plan is the accent because
 * it is the thing you edit; a ride is data, which the accent never is — and a green over the green plan would not show.
 */
private val RIDDEN_COLOUR = Color(0xFFCE7A0C)

/** A beeline's weight and dash, and how faint a routing one gets at the low of its pulse. */
private val BEELINE_WIDTH = 3.dp
private val BEELINE_DASH: List<Number> = listOf(2, 2.5)
private const val UNROUTABLE_OPACITY = 0.5f
private const val ROUTING_REST_OPACITY = 0.55f
private const val ROUTING_LOW_OPACITY = 0.2f
private const val ROUTING_PERIOD_MS = 1100

/** Below this a shaping point is noise: a dot on a line whose shape is the only thing readable. */
private const val SHAPING_MIN_ZOOM = 10f

/** How big a waypoint's handle is under a finger: bigger than the marker, which is drawn for the eye. */
private val HANDLE_SIZE = 44.dp

/** A stop's marker, and a waypoint's once a long press has picked it up. */
private val STOP_RADIUS = 7.dp
private val HELD_STOP_RADIUS = 11.dp
private val HELD_SHAPING_RADIUS = 6.dp

/** The map's labels a stop may take its name from, most specific first: things, then stations, then places. */
private val NAMED_LAYERS = setOf(
    "poi-amenity", "poi-leisure", "poi-tourism", "poi-shop", "poi-man_made", "poi-historic", "poi-emergency",
    "poi-highway", "poi-office", "symbol-transit-station", "symbol-transit-airfield", "symbol-transit-airport",
    "label-place-neighbourhood", "label-place-quarter", "label-place-suburb", "label-place-hamlet",
    "label-place-village", "label-place-town", "label-place-city", "label-place-statecapital", "label-place-capital",
)

/** How far from a tap a label still names it. */
private val NAME_REACH = 16.dp

private fun widthByZoom(stops: List<Pair<Int, Double>>) =
    interpolate(linear(), zoom(), *stops.map { (z, width) -> z to const(width.toFloat().dp) }.toTypedArray())

private const val EMPTY_COLLECTION = """{"type":"FeatureCollection","features":[]}"""

private fun lineFeature(points: List<Coordinate>): String = points.joinToString(
    separator = ",",
    prefix = """{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[""",
    postfix = "]}}",
) { "[${it.lon},${it.lat}]" }

/** Lines as one collection. MapLibre refuses a line of fewer than two points, so those are left out. */
private fun linesJson(lines: List<List<Coordinate>>): String =
    lines.filter { it.size >= 2 }.joinToString(",", """{"type":"FeatureCollection","features":[""", "]}", transform = ::lineFeature)

private fun pointsJson(marks: List<WaypointMark>): String = marks.joinToString(
    ",",
    """{"type":"FeatureCollection","features":[""",
    "]}",
) { """{"type":"Feature","properties":{"label":${JsonPrimitive(it.label)}},"geometry":{"type":"Point","coordinates":[${it.at.lon},${it.at.lat}]}}""" }

private fun Fix.measurement() = LocationMeasurement(
    position = Position(longitude = at.lon, latitude = at.lat),
    horizontalAccuracy = accuracyM?.meters,
    distancePerSecond = speedMps?.meters,
    course = courseDeg?.let { Bearing.North + it.degrees },
    measuredAt = Instant.fromEpochMilliseconds(epochMillis),
)

private const val FOLLOW_MS = 950L

/** How wide the cone that shows where the phone faces is: roughly what the eye takes in. */
private const val FIELD_OF_VIEW_DEG = 60.0

/** How far the cone reaches from the rider before it has faded out. */
private val FACING_REACH = 46.dp

/** The cone's blue: not the accent, which the plan line is, and which a cone lying along it would vanish into. */
private val FACING_COLOUR = Color(0xFF2F6FD6)

private fun pointJson(at: Coordinate?): String = at?.let {
    """{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[${it.lon},${it.lat}]}}"""
} ?: EMPTY_COLLECTION

/**
 * A cone [sweepDeg] wide, pointing up from the centre and fading out towards its edge: rotated by the heading, it points
 * where the phone faces.
 */
private class FacingCone(private val color: Color, private val sweepDeg: Float) : Painter() {
    override val intrinsicSize: Size get() = Size.Unspecified

    override fun DrawScope.onDraw() {
        val fade = Brush.radialGradient(listOf(color.copy(alpha = 0.55f), color.copy(alpha = 0f)), center = center, radius = size.minDimension / 2)
        // Compose measures angles clockwise from three o'clock; up is -90°.
        drawArc(brush = fade, startAngle = -90f - sweepDeg / 2, sweepAngle = sweepDeg, useCenter = true)
    }
}

@Composable
private fun MapLibreMap(
    style: MapStyle,
    camera: MapCamera,
    plan: List<Coordinate>,
    ridden: List<Coordinate>,
    fix: Fix?,
    heading: Heading?,
    drawing: PlanDrawing?,
    onTap: (Coordinate) -> Unit,
    onPlace: ((Coordinate, String?) -> Unit)?,
    onLongPress: ((Coordinate) -> Unit)?,
    onLongPlace: ((Coordinate, String?) -> Unit)?,
    onWaypointTap: (Int) -> Unit,
    onWaypointDrag: (Int, Coordinate, Boolean) -> Unit,
    onGesture: () -> Unit,
    marker: Coordinate?,
    highlight: List<Coordinate>,
    highlightRidden: Boolean,
    onIdle: () -> Unit,
) {
    val currentCamera by rememberUpdatedState(camera)
    val currentFix by rememberUpdatedState(fix)
    val currentHeading by rememberUpdatedState(heading)
    val currentOnTap by rememberUpdatedState(onTap)
    val currentOnPlace by rememberUpdatedState(onPlace)
    val currentOnLongPress by rememberUpdatedState(onLongPress)
    val currentOnLongPlace by rememberUpdatedState(onLongPlace)
    val currentOnIdle by rememberUpdatedState(onIdle)
    val currentOnGesture by rememberUpdatedState(onGesture)
    val layoutDirection = LocalLayoutDirection.current
    val scope = rememberCoroutineScope()

    // What each layer draws. Without a drawing, the plan is one routed line.
    val riddenJson = remember(ridden) { linesJson(listOf(ridden)) }
    val highlightJson = remember(highlight) { linesJson(listOf(highlight)) }
    val routedJson = remember(plan, drawing) {
        linesJson(drawing?.legs?.filter { it.state == LegState.Routed }?.map { it.coordinates } ?: listOf(plan))
    }
    val routingJson = remember(drawing) { linesJson(drawing?.legs?.filter { it.state == LegState.Routing }?.map { it.coordinates } ?: emptyList()) }
    val unroutableJson = remember(drawing) { linesJson(drawing?.legs?.filter { it.state == LegState.Unroutable }?.map { it.coordinates } ?: emptyList()) }
    // The waypoint a finger holds is drawn larger, by layers of its own, so it shows it has been picked up.
    var held by remember { mutableStateOf<Int?>(null) }
    val marks = drawing?.waypoints ?: emptyList()
    val heldMark = held?.let(marks::getOrNull)
    val stopsJson = remember(drawing) { pointsJson(marks.filter { it.stop }) }
    val restingStopsJson = remember(drawing, held) { pointsJson(marks.filterIndexed { i, it -> it.stop && i != held }) }
    val shapingJson = remember(drawing, held) { pointsJson(marks.filterIndexed { i, it -> !it.stop && i != held }) }
    val heldStopJson = remember(drawing, held) { pointsJson(listOfNotNull(heldMark?.takeIf { it.stop })) }
    val heldShapingJson = remember(drawing, held) { pointsJson(listOfNotNull(heldMark?.takeUnless { it.stop })) }
    // How many fingers are on the map, handles included: a second one ends a pick-up or a drag.
    var fingers by remember { mutableIntStateOf(0) }

    // The one thing on the map that moves on its own, because it is the one thing waiting on somebody else.
    val waiting = drawing != null && drawing.pulse && drawing.legs.any { it.state == LegState.Routing }
    // Pulsed by MapLibre, not by recomposing every frame: the opacity flips between its two ends every half period and
    // the layer's own transition fades between them. On the phone an opacity set every frame drew no routing dash at all
    // (tried on the SE2); flipped twice a period, it pulses.
    var low by remember { mutableStateOf(false) }
    LaunchedEffect(waiting) {
        low = false
        while (waiting) {
            delay((ROUTING_PERIOD_MS / 2).milliseconds)
            low = !low
        }
    }
    val routingOpacity = if (waiting && low) ROUTING_LOW_OPACITY else ROUTING_REST_OPACITY

    // Start where the camera is going when that is known, rather than flying in: every tile a fly-in passes through is
    // one more download, on a phone that may be on a hillside's last bar of signal.
    val initialCamera = remember {
        val at = fix?.at ?: plan.firstOrNull() ?: drawing?.waypoints?.firstOrNull()?.at ?: Coordinate(47.4917, 11.0950)
        when (camera) {
            is MapCamera.Follow -> CameraPosition(
                target = Position(at.lon, at.lat),
                zoom = camera.zoom,
                bearing = mapBearing(camera.orientation, fix, heading, previous = 0.0),
            )
            is MapCamera.Overview, MapCamera.Free, is MapCamera.Show -> CameraPosition(target = Position(at.lon, at.lat), zoom = 13.0)
            is MapCamera.Centre -> CameraPosition(target = Position(at.lon, at.lat), zoom = camera.zoom)
        }
    }

    val state = rememberMapState(
        baseStyle = remember(style) { BaseStyle.Json(style.json) },
        initialCameraPosition = initialCamera,
    ) {
        val routedSource = rememberGeoJsonSource(GeoJsonData.JsonString(routedJson))
        LineLayer(
            id = "plan-casing",
            source = routedSource,
            color = const(Tokens.ink),
            opacity = const(PLAN_CASING_OPACITY),
            width = widthByZoom(PLAN_CASING_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )
        LineLayer(
            id = "plan",
            source = routedSource,
            color = const(Tokens.accent),
            // Held back while a stretch of it is selected on the profile, so the stretch drawn over it reads as
            // *this piece* rather than as a second line.
            opacity = const(if (highlight.size > 1 && !highlightRidden) HELD_BACK else 1f),
            width = widthByZoom(PLAN_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )

        // The stretch the two bars enclose, over the line it is part of: **the plan's own colour**, picked out by a
        // white border rather than repainted. A stretch drawn in ink would answer *which piece* by destroying the
        // answer to *what is this line*.
        val highlightSource = rememberGeoJsonSource(GeoJsonData.JsonString(highlightJson))
        LineLayer(
            id = "plan-highlight-casing",
            source = highlightSource,
            color = const(Color.White),
            width = widthByZoom(HIGHLIGHT_CASING_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )
        LineLayer(
            id = "plan-highlight",
            source = highlightSource,
            color = const(if (highlightRidden) RIDDEN_COLOUR else Tokens.accent),
            width = widthByZoom(PLAN_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )

        // Over the plan, at the plan's weight: where you went, drawn on where you meant to.
        LineLayer(
            id = "ridden",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(riddenJson)),
            color = const(RIDDEN_COLOUR),
            opacity = const(if (highlight.size > 1 && highlightRidden) HELD_BACK else 1f),
            width = widthByZoom(PLAN_WIDTH),
            cap = const(LineCap.Round),
            join = const(LineJoin.Round),
        )

        // Could not be routed: dashed and uncased, so it reads as a gap in the plan rather than as part of it.
        LineLayer(
            id = "plan-unroutable",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(unroutableJson)),
            color = const(Tokens.ink),
            opacity = const(UNROUTABLE_OPACITY),
            width = const(BEELINE_WIDTH),
            dasharray = const(BEELINE_DASH),
            cap = const(LineCap.Butt),
            join = const(LineJoin.Round),
        )
        // Not a route yet: the same dash in the plan's own colour.
        LineLayer(
            id = "plan-routing",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(routingJson)),
            color = const(Tokens.accent),
            opacity = const(routingOpacity),
            opacityTransition = TransitionOptions(duration = (ROUTING_PERIOD_MS / 2).milliseconds),
            width = const(BEELINE_WIDTH),
            dasharray = const(BEELINE_DASH),
            cap = const(LineCap.Butt),
            join = const(LineJoin.Round),
        )

        // A shaping point is a property of the route, not a place: small, white, on the line, in the route's colour.
        CircleLayer(
            id = "plan-shaping",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(shapingJson)),
            minZoom = SHAPING_MIN_ZOOM,
            color = const(Color.White),
            opacity = const(0.9f),
            radius = const(3.5.dp),
            strokeWidth = const(1.5.dp),
            strokeColor = const(Tokens.accent),
        )
        CircleLayer(
            id = "plan-shaping-held",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(heldShapingJson)),
            color = const(Color.White),
            radius = const(HELD_SHAPING_RADIUS),
            strokeWidth = const(2.dp),
            strokeColor = const(Tokens.accent),
        )
        // A stop is the plan, so it is the plan's colour, ringed in white to hold against the terrain.
        CircleLayer(
            id = "plan-stops",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(restingStopsJson)),
            color = const(Tokens.accent),
            radius = const(STOP_RADIUS),
            strokeWidth = const(2.5.dp),
            strokeColor = const(Color.White),
        )
        CircleLayer(
            id = "plan-stops-held",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(heldStopJson)),
            color = const(Tokens.accent),
            radius = const(HELD_STOP_RADIUS),
            strokeWidth = const(3.dp),
            strokeColor = const(Color.White),
        )
        SymbolLayer(
            id = "plan-stop-labels",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(stopsJson)),
            textField = format(span(feature.get("label").asString())),
            textFont = const(listOf("noto_sans_bold")),
            textSize = const(12.sp),
            textOffset = textOffset(0.em, 1.1.em),
            textAnchor = const(SymbolAnchor.Top),
            textOptional = const(true),
            textColor = const(Tokens.ink),
            textHaloColor = const(Color.White.copy(alpha = 0.92f)),
            textHaloWidth = const(1.6.dp),
        )

        // A place picked off the map, as a profile tap picks one: a ring in ink, which neither the plan nor the ride is.
        CircleLayer(
            id = "picked",
            source = rememberGeoJsonSource(GeoJsonData.JsonString(pointJson(marker))),
            color = const(Color.White),
            radius = const(7.dp),
            strokeWidth = const(3.dp),
            strokeColor = const(Tokens.ink),
        )

        // Where the phone faces: a fading cone out of the dot, FIELD_OF_VIEW_DEG wide, from the compass rather than the
        // course. It is what you are looking at, which a rider stopped at a junction wants to know and a course cannot
        // say. Turned with the map, so it points the same way whichever way up the map is. Under the dot, so the dot
        // stays where you are.
        val facing = currentHeading
        val rider = currentFix
        val facingSource = rememberGeoJsonSource(GeoJsonData.JsonString(pointJson(rider?.at)))
        val facingPainter = remember { FacingCone(FACING_COLOUR, FIELD_OF_VIEW_DEG.toFloat()) }
        SymbolLayer(
            id = "rider-facing",
            source = facingSource,
            visible = facing != null && rider != null,
            iconImage = image(facingPainter, size = DpSize(FACING_REACH * 2, FACING_REACH * 2)),
            iconAnchor = const(SymbolAnchor.Center),
            iconRotate = const((facing?.degrees ?: 0.0).toFloat()),
            iconRotationAlignment = const(IconRotationAlignment.Map),
            iconAllowOverlap = const(true),
            iconIgnorePlacement = const(true),
        )

        // Accent, and the white rim is what keeps it off the plan line it rides on — the line is the same green, so
        // without the rim the dot would sit inside its own colour. It was ink for exactly that reason and the rim
        // answers it better: you are the app's own colour, like everything else you can act on. The library's own
        // bearing marks — an arrow, and a thin arc on the dot's rim — are off; the facing cone under it replaces them.
        LocationPuck(
            idPrefix = "rider",
            location = currentFix?.measurement(),
            bearing = null,
            colors = LocationPuckColors(
                dotFillColorCurrentLocation = Tokens.accent,
                dotFillColorOldLocation = Tokens.muted,
                dotStrokeColor = Color.White,
                accuracyStrokeColor = Color.Transparent,
                accuracyFillColor = Color.Transparent,
            ),
        )
    }

    LaunchedEffect(state) {
        state.events.collect { if (it == MapEvent.Idle) currentOnIdle() }
    }

    // Exactly one camera effect, keyed on the state, reading its inputs through snapshotFlow: a new fix every second
    // must not cancel and restart the effect, or the camera never finishes an animation. The camera is acted on when
    // it changes; only Follow also moves with the fixes, always back to its own zoom.
    LaunchedEffect(state) {
        snapshotFlow { currentCamera }.collectLatest { camera ->
            when (camera) {
                is MapCamera.Follow -> {
                    snapshotFlow { currentFix to currentHeading }.collectLatest { (fix, heading) ->
                        if (fix == null) return@collectLatest
                        val zoom = camera.zoom
                        val bearing = mapBearing(camera.orientation, fix, heading, previous = state.cameraPosition.bearing)
                        val aim = insetTarget(fix.at, zoom, bearing, camera.inset, layoutDirection)
                        state.animateCameraPosition(
                            CameraPosition(target = Position(aim.lon, aim.lat), zoom = zoom, bearing = bearing),
                            duration = FOLLOW_MS.milliseconds,
                        )
                    }
                }
                is MapCamera.Centre -> {
                    val fix = snapshotFlow { currentFix }.filterNotNull().first()
                    val aim = insetTarget(fix.at, camera.zoom, 0.0, camera.inset, layoutDirection)
                    state.animateCameraPosition(
                        CameraPosition(target = Position(aim.lon, aim.lat), zoom = camera.zoom),
                        duration = FOLLOW_MS.milliseconds,
                    )
                }
                MapCamera.Free -> Unit
                is MapCamera.Show -> {
                    val position = state.cameraPosition
                    val aim = insetTarget(camera.at, position.zoom, position.bearing, camera.inset, layoutDirection)
                    state.animateCameraPosition(position.copy(target = Position(aim.lon, aim.lat)), duration = FOLLOW_MS.milliseconds)
                }
                is MapCamera.Overview -> if (camera.points.isNotEmpty()) {
                    state.animateCameraToBounds(
                        BoundingBox(
                            west = camera.points.minOf { it.lon },
                            south = camera.points.minOf { it.lat },
                            east = camera.points.maxOf { it.lon },
                            north = camera.points.maxOf { it.lat },
                        ),
                        padding = camera.inset,
                        duration = 600.milliseconds,
                    )
                }
            }
        }
    }

    Box(
        Modifier.pointerInput(Unit) {
            // Watched before anything below takes the touch, and never consumed: the map and the handles still get it.
            // A second finger, or one that has moved further than a tap may, is a gesture on the map; a long press
            // stays where it landed, and is not.
            val slop = viewConfiguration.touchSlop
            awaitPointerEventScope {
                val downs = HashMap<PointerId, Offset>()
                var gestured = false
                while (true) {
                    val changes = awaitPointerEvent(PointerEventPass.Initial).changes
                    fingers = changes.count { it.pressed }
                    for (change in changes) {
                        if (change.pressed) downs.getOrPut(change.id) { change.position } else downs.remove(change.id)
                    }
                    if (downs.isEmpty()) {
                        gestured = false
                        continue
                    }
                    val moved = changes.any { change -> downs[change.id]?.let { (change.position - it).getDistance() > slop } == true }
                    if (!gestured && (downs.size > 1 || moved)) {
                        gestured = true
                        currentOnGesture()
                    }
                }
            }
        },
    ) {
        MaplibreMap(
            state = state,
            interactions = remember {
                MapInteractions {
                    callbacks {
                        click {
                            onUnhandled { event ->
                                val at = event.position ?: return@onUnhandled ClickResult.Pass
                                val coordinate = Coordinate(lat = at.latitude, lon = at.longitude)
                                val place = currentOnPlace
                                if (place == null) {
                                    currentOnTap(coordinate)
                                } else {
                                    val screen = event.screenOffset
                                    scope.launch { place(coordinate, nameAt(state, screen)) }
                                }
                                ClickResult.Consume
                            }
                        }
                        longClick {
                            onEvent { event ->
                                val at = event.position ?: return@onEvent ClickResult.Pass
                                val coordinate = Coordinate(lat = at.latitude, lon = at.longitude)
                                val place = currentOnLongPlace
                                val press = currentOnLongPress
                                when {
                                    place != null -> {
                                        val screen = event.screenOffset
                                        scope.launch { place(coordinate, nameAt(state, screen)) }
                                    }
                                    press != null -> press(coordinate)
                                    else -> return@onEvent ClickResult.Pass
                                }
                                ClickResult.Consume
                            }
                        }
                    }
                }
            },
        ) {
            // Only the credit OpenStreetMap's licence asks for. The default overlay's logo and compass collide with the
            // app's own controls, and its scale bar is in feet.
            MapCreditButton()
        }

        drawing?.takeIf { it.editable }?.let {
            WaypointHandles(state, it.waypoints, { fingers }, { index -> held = index }, onWaypointTap, onWaypointDrag)
        }
    }
}

private fun insetTarget(at: Coordinate, zoom: Double, bearing: Double, inset: PaddingValues, direction: LayoutDirection) =
    insetTarget(
        at = at,
        zoom = zoom,
        bearingDeg = bearing,
        downDp = (inset.calculateBottomPadding() - inset.calculateTopPadding()).value / 2.0,
        rightDp = (inset.calculateRightPadding(direction) - inset.calculateLeftPadding(direction)).value / 2.0,
    )

/** The name of the place labelled nearest a tap, from the map's own labels: English where the tiles have it. */
private suspend fun nameAt(state: MapState, at: DpOffset): String? {
    val reach = DpRect(at.x - NAME_REACH, at.y - NAME_REACH, at.x + NAME_REACH, at.y + NAME_REACH)
    val features = try {
        state.queryRenderedFeatures(reach, NAMED_LAYERS)
    } catch (e: IllegalStateException) {
        // The map is not ready to be asked yet; a stop placed now simply has no name from it.
        return null
    }
    for (feature in features) {
        val properties = feature.properties ?: continue
        val name = (properties["name_en"] ?: properties["name"]) as? JsonPrimitive ?: continue
        if (name.isString && name.content.isNotBlank()) return name.content
    }
    return null
}


/**
 * Touch targets over each waypoint, placed where the map draws it and moved with the camera: a tap edits one, and a long
 * press picks it up to be dragged. They are Compose over the map rather than map layers, so a drag on one never pans the
 * map beneath it. [fingers] counts the fingers on the whole map; [onHeld] reports which waypoint is picked up, if any.
 */
@Composable
private fun WaypointHandles(
    state: MapState,
    waypoints: List<WaypointMark>,
    fingers: () -> Int,
    onHeld: (Int?) -> Unit,
    onTap: (Int) -> Unit,
    onDrag: (Int, Coordinate, Boolean) -> Unit,
) {
    val currentOnTap by rememberUpdatedState(onTap)
    val currentOnDrag by rememberUpdatedState(onDrag)
    val currentOnHeld by rememberUpdatedState(onHeld)
    // Read so the handles follow the camera: the position is Compose state.
    state.cameraPosition

    waypoints.forEachIndexed { index, mark ->
        key(index) {
            val screen = runCatching { state.screenLocationFromPosition(Position(mark.at.lon, mark.at.lat)) }.getOrNull()
            if (screen != null) WaypointHandle(state, index, mark, screen, fingers, currentOnHeld, currentOnTap, currentOnDrag)
        }
    }
}

/** How a finger resting on a waypoint's handle ended before it was held long enough to pick the waypoint up. */
private enum class Press { Tapped, Abandoned }

/**
 * One waypoint's touch target.
 *
 * A waypoint moves only after a long press, so a pinch whose finger lands on one zooms rather than drags it. Picking it up
 * is felt and seen: a haptic tick, and the marker grows. Let go without moving, nothing changes. A second finger before
 * the press is long enough abandons it; a second finger mid-drag puts the waypoint back where it was picked up.
 *
 * Its gesture is keyed on the waypoint's index alone. Every step of a drag moves the waypoint, and a gesture keyed on
 * where it is would be torn down after the first step, leaving the editor sure a drag is still on: every leg drawn as a
 * still straight dash, routed or not. While a drag is on, the target stays where the drag began, so the finger's movement
 * is measured against a target that does not move under it; the map draws the waypoint where the finger is.
 */
@Composable
private fun WaypointHandle(
    state: MapState,
    index: Int,
    mark: WaypointMark,
    screen: DpOffset,
    fingers: () -> Int,
    onHeld: (Int?) -> Unit,
    onTap: (Int) -> Unit,
    onDrag: (Int, Coordinate, Boolean) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val currentMark by rememberUpdatedState(mark)
    val currentScreen by rememberUpdatedState(screen)
    var anchor by remember { mutableStateOf<DpOffset?>(null) }

    val place = anchor ?: screen
    Box(
        Modifier
            .offset(place.x - HANDLE_SIZE / 2, place.y - HANDLE_SIZE / 2)
            .size(HANDLE_SIZE)
            .pointerInput(index) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val press = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                        while (true) {
                            val event = awaitPointerEvent()
                            if (fingers() > 1 || event.changes.count { it.pressed } > 1) return@withTimeoutOrNull Press.Abandoned
                            val change = event.changes.firstOrNull { it.id == down.id } ?: continue
                            if (change.isConsumed) return@withTimeoutOrNull Press.Abandoned
                            if (!change.pressed) {
                                change.consume()
                                return@withTimeoutOrNull Press.Tapped
                            }
                            if ((change.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                return@withTimeoutOrNull Press.Abandoned
                            }
                        }
                    }
                    when (press) {
                        Press.Tapped -> onTap(index)
                        Press.Abandoned -> Unit
                        null -> {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            val origin = currentMark.at
                            var dragged = currentScreen
                            var moved = false
                            anchor = currentScreen
                            onHeld(index)
                            fun draggedAt() = state.positionFromScreenLocation(dragged)
                                ?.let { Coordinate(lat = it.latitude, lon = it.longitude) } ?: currentMark.at
                            fun end(at: Coordinate) {
                                anchor = null
                                onHeld(null)
                                // Held and let go without moving: the plan is unchanged, and nothing routes again.
                                if (moved) onDrag(index, at, true)
                            }
                            try {
                                while (true) {
                                    val event = awaitPointerEvent()
                                    if (fingers() > 1 || event.changes.count { it.pressed } > 1) {
                                        end(origin)
                                        break
                                    }
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: continue
                                    val amount = change.positionChange()
                                    change.consume()
                                    if (!change.pressed) {
                                        end(draggedAt())
                                        break
                                    }
                                    if (amount != Offset.Zero) {
                                        dragged = DpOffset(dragged.x + amount.x.toDp(), dragged.y + amount.y.toDp())
                                        moved = true
                                        onDrag(index, draggedAt(), false)
                                    }
                                }
                            } finally {
                                // Torn down mid-drag — the waypoint removed, the editor left, the platform taking the
                                // touch back: the drag still ends where it is, or the plan would never route again.
                                if (anchor != null) end(draggedAt())
                            }
                        }
                    }
                }
            },
    )
}
