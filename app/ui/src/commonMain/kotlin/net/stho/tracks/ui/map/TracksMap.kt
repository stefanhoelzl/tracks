package net.stho.tracks.ui.map

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.SideEffect
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
import androidx.compose.runtime.snapshots.Snapshot
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
import androidx.compose.ui.unit.dp
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
import net.stho.tracks.ui.measure.Ablation
import net.stho.tracks.ui.measure.MapFrames
import net.stho.tracks.ui.measure.MapIdles
import net.stho.tracks.ui.measure.MeasureOverrides
import net.stho.tracks.ui.measure.RecomposeCounts
import net.stho.tracks.ui.resources.Res
import net.stho.tracks.ui.theme.Tokens
import org.maplibre.compose.camera.CameraMoveReason
import org.maplibre.compose.camera.CameraPosition
import org.maplibre.compose.interaction.ClickResult
import org.maplibre.compose.interaction.MapInteractions
import org.maplibre.compose.location.LocationMeasurement
import org.maplibre.compose.location.LocationPuck
import org.maplibre.compose.location.LocationPuckColors
import org.maplibre.compose.map.MapEvent
import org.maplibre.compose.map.MapState
import org.maplibre.compose.map.RenderOptions
import org.maplibre.compose.map.MaplibreMap
import org.maplibre.compose.map.rememberMapState
import org.maplibre.compose.sources.GeoJsonData
import org.maplibre.compose.style.BaseStyle
import org.maplibre.compose.style.TransitionOptions
import org.maplibre.spatialk.geojson.BoundingBox
import org.maplibre.spatialk.geojson.Position
import org.maplibre.spatialk.units.Bearing
import org.maplibre.spatialk.units.extensions.degrees
import org.maplibre.spatialk.units.extensions.meters
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import kotlinx.serialization.json.JsonObject
import org.maplibre.compose.map.StyleLoadState
import org.maplibre.compose.sources.GeoJsonSourceHandle

// -------------------------------------------------------------------------------------------------------------------
// The app's map. Nothing in these signatures names a MapLibre type, and nothing outside this package imports one:
// maplibre-compose is pinned and wrapped here so that an upgrade is this package and a deliberate act.
// -------------------------------------------------------------------------------------------------------------------

/**
 * A style the map can draw — the style document itself, as JSON, with the overlays (`Overlays.kt`) already in it.
 *
 * Offline data (M13) is another way to make one, not another parameter on the map.
 */
class MapStyle(val json: String, internal val facingColour: Color = FACING_COLOUR) {
    companion object {
        /**
         * VersaTiles' `colorful`, washed as the web washes it, with the web's overlays over it: `pnpm style:app` writes
         * both files with the web's own code.
         */
        suspend fun colorful(): MapStyle {
            val overlays = Res.readBytes("files/overlays.json").decodeToString()
            val style = Res.readBytes("files/colorful.json").decodeToString()
            val facing = imageColour(overlays, OverlayIds.RIDER_FACING_LAYER)?.let(::hexColour) ?: FACING_COLOUR
            return MapStyle(withOverlays(style, overlays), facing)
        }
    }
}

/** `#rrggbb`, as the overlays write a colour. */
internal fun hexColour(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

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
 *
 * [heading] is a read rather than a value, and only this map makes it: a compass fires up to ~30 times a second while
 * the phone moves, and a value handed down recomposes every composable it passes through on each one. Read here, it
 * reaches the facing cone and — below walking pace, heading-up — the camera, and recomposes nothing.
 */
@Composable
fun TracksMap(
    style: MapStyle,
    camera: MapCamera,
    modifier: Modifier = Modifier,
    plan: List<Coordinate> = emptyList(),
    ridden: List<Coordinate> = emptyList(),
    fix: Fix? = null,
    heading: () -> Heading? = { null },
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
    /** A card standing on a place: the editor's waypoint dialog. */
    pinned: Pinned? = null,
) {
    SideEffect { RecomposeCounts.tracksMap++ }
    // A Metal or Vulkan surface created at 0×0 never recovers (the KRAIL pitfalls): wait for a size, once.
    var sized by remember { mutableStateOf(false) }
    Box(modifier.onSizeChanged { if (it.width > 0 && it.height > 0) sized = true }) {
        when {
            !sized -> {}
            // Measure-only (Ablation): the screen without its map, and a camera that never follows.
            Ablation.noMap -> {}
            else -> MapLibreMap(
                style, if (Ablation.staticCamera) MapCamera.Free else camera, plan, ridden, fix, heading, drawing, onTap, onPlace,
                onLongPress, onLongPlace, onWaypointTap, onWaypointDrag, onGesture, marker, highlight, highlightRidden, onIdle,
                pinned,
            )
        }
    }
}

/**
 * What the plan line or the ride drops to while a stretch of it is picked out on the profile: the web's `HELD_BACK`
 * (layers.ts). A live value, set on the layer as the stretch comes and goes, so it lives with the code that sets it.
 */
private const val HELD_BACK = 0.28

/** How faint a routing leg gets at the low of its pulse, and how long a pulse takes: the web's `PENDING_OPACITY`. */
private const val ROUTING_REST_OPACITY = 0.55
private const val ROUTING_LOW_OPACITY = 0.2
private const val ROUTING_PERIOD_MS = 1100

/** How big a waypoint's handle is under a finger: bigger than the marker, which is drawn for the eye. */
private val HANDLE_SIZE = 44.dp

/** The map's labels a stop may take its name from, most specific first: things, then stations, then places. */
private val NAMED_LAYERS = setOf(
    "poi-amenity", "poi-leisure", "poi-tourism", "poi-shop", "poi-man_made", "poi-historic", "poi-emergency",
    "poi-highway", "poi-office", "symbol-transit-station", "symbol-transit-airfield", "symbol-transit-airport",
    "label-place-neighbourhood", "label-place-quarter", "label-place-suburb", "label-place-hamlet",
    "label-place-village", "label-place-town", "label-place-city", "label-place-statecapital", "label-place-capital",
)

/** How far from a tap a label still names it. */
private val NAME_REACH = 16.dp

private const val EMPTY_COLLECTION = """{"type":"FeatureCollection","features":[]}"""

private fun collection(features: List<String>): String = features.joinToString(",", """{"type":"FeatureCollection","features":[""", "]}")

private fun properties(vararg entries: Pair<String, Any>): String = JsonObject(
    entries.associate { (key, value) ->
        key to when (value) {
            is Boolean -> JsonPrimitive(value)
            is Number -> JsonPrimitive(value)
            else -> JsonPrimitive(value.toString())
        }
    },
).toString()

/** A line, or nothing: MapLibre refuses a line of fewer than two points. */
private fun lineFeature(points: List<Coordinate>, properties: String = "{}"): String? = points.takeIf { it.size >= 2 }?.joinToString(
    separator = ",",
    prefix = """{"type":"Feature","properties":$properties,"geometry":{"type":"LineString","coordinates":[""",
    postfix = "]}}",
) { "[${it.lon},${it.lat}]" }

private fun pointFeature(at: Coordinate, properties: String = "{}"): String =
    """{"type":"Feature","properties":$properties,"geometry":{"type":"Point","coordinates":[${at.lon},${at.lat}]}}"""

/**
 * The plan's legs, as `plan-layers.ts` reads them: `routed` for a route, `pending` for a leg still being routed, and
 * neither for a straight line that is not going to be one. Without a drawing, the plan is one routed line.
 */
private fun planJson(plan: List<Coordinate>, drawing: PlanDrawing?): String {
    val legs = drawing?.legs ?: listOf(LegLine(plan, LegState.Routed))
    return collection(
        legs.mapIndexedNotNull { index, leg ->
            lineFeature(
                leg.coordinates,
                properties("leg" to index, "routed" to (leg.state == LegState.Routed), "pending" to (leg.state == LegState.Routing)),
            )
        },
    )
}

/** The waypoints: stops (`poi`) and shaping points, and which one a finger holds, which is drawn larger. */
private fun waypointsJson(marks: List<WaypointMark>, held: Int?): String = collection(
    marks.mapIndexed { index, mark ->
        pointFeature(mark.at, properties("index" to index, "poi" to mark.stop, "label" to mark.label, "held" to (index == held)))
    },
)

private fun Fix.measurement() = LocationMeasurement(
    position = Position(longitude = at.lon, latitude = at.lat),
    horizontalAccuracy = accuracyM?.meters,
    distancePerSecond = speedMps?.meters,
    course = courseDeg?.let { Bearing.North + it.degrees },
    measuredAt = Instant.fromEpochMilliseconds(epochMillis),
)

/**
 * How long Follow glides to each new fix. Fixes come once a second, and at the 950 ms this was the camera moved 95% of
 * the time — and a moving camera keeps MapLibre building render trees and re-placing symbols for as long as it moves:
 * 250 ms, with the frame cap below, is the largest part of what the battery fixes saved (app/docs/BATTERY.md). The price
 * is a map that steps once a second rather than gliding continuously, a few pixels a step at riding zoom.
 */
private const val FOLLOW_MS = 250L

/** How long a camera the app asks for travels: to the rider for Centre, to a place for Show. Once, so unhurried. */
private const val FLIGHT_MS = 950L

/**
 * How often MapLibre may draw while nothing anyone would watch is moving: the rider's dot, the ridden line, the cone and
 * Follow's step to each fix.
 *
 * Any change on the map — a dot moved once a second is enough — restarts MapLibre's symbol-placement cross-fade, and
 * while it fades MapLibre draws at the display's rate; so a riding map drew 60 frames a second for the whole ride, at
 * ~0.44 of an A13 core. Capped at 15 that was 60% cheaper on the SE2 (app/docs/BATTERY.md, "Root cause: the
 * symbol placement cross-fade"). The fade itself can be switched off only through an API maplibre-compose 0.16 keeps
 * internal; with this cap and Follow's short step it would save nothing more, measured. At riding zoom a fix moves the map a few pixels, which
 * 15 frames a second draws as smoothly as 60.
 *
 * It is lifted — [RenderOptions.Standard], the display's rate — for everything a person would see stutter, and only
 * those: a finger on the map, the fling that outlives it, a camera the app flies somewhere, and the pulse of a leg
 * being routed.
 */
private const val MAX_FPS = 15

private val CAPPED = RenderOptions { maximumFps = MAX_FPS }

/** How wide the cone that shows where the phone faces is: roughly what the eye takes in. */
private const val FIELD_OF_VIEW_DEG = 60.0

/** How far the cone reaches from the rider before it has faded out. */
private val FACING_REACH = 46.dp

/** The cone's blue, until the overlays name it (`rider-facing`'s `metadata.imageColour`): the web's own choice. */
private val FACING_COLOUR = Color(0xFF2F6FD6)

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

/** The facing cone, as the style image the `rider-facing` layer draws: FACING_REACH across each way from the rider. */
private fun facingCone(colour: Color, density: Density): ImageBitmap {
    val side = with(density) { (FACING_REACH * 2).toPx() }
    val size = Size(side, side)
    val bitmap = ImageBitmap(side.toInt(), side.toInt())
    val painter = FacingCone(colour, FIELD_OF_VIEW_DEG.toFloat())
    CanvasDrawScope().draw(density, LayoutDirection.Ltr, Canvas(bitmap), size) { with(painter) { draw(size) } }
    return bitmap
}

/** The rider at [at], carrying the [heading] the facing cone turns to; nothing until both are known. */
private fun riderJson(at: Coordinate?, heading: Heading?): String =
    if (at == null || heading == null) EMPTY_COLLECTION else collection(listOf(pointFeature(at, properties("bearing" to heading.degrees))))

/** Keeps a style source holding [json], once the style is [loaded] — and again after every reload, which empties it. */
@Composable
private fun Feed(state: MapState, loaded: Boolean, source: String, json: String) {
    LaunchedEffect(state, loaded, json) {
        if (!loaded) return@LaunchedEffect
        val handle = state.style.sources[source] as? GeoJsonSourceHandle
        checkNotNull(handle?.asMutable) { "overlays.json has no GeoJSON source '$source'" }.setData(GeoJsonData.JsonString(json))
    }
}

/** Keeps a style layer's paint [property] at [value]: the few overlay values that are live rather than styled. */
@Composable
private fun Paint(state: MapState, loaded: Boolean, layer: String, property: String, value: Double) {
    LaunchedEffect(state, loaded, value) {
        if (!loaded) return@LaunchedEffect
        checkNotNull(state.style.layers[layer]?.asMutable) { "overlays.json has no layer '$layer'" }
            .setPaintProperty(property, JsonPrimitive(value))
    }
}

@Composable
private fun MapLibreMap(
    style: MapStyle,
    camera: MapCamera,
    plan: List<Coordinate>,
    ridden: List<Coordinate>,
    fix: Fix?,
    heading: () -> Heading?,
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
    pinned: Pinned?,
) {
    SideEffect { RecomposeCounts.mapLibreMap++ }
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

    // The waypoint a finger holds is drawn larger, so it shows it has been picked up.
    var held by remember { mutableStateOf<Int?>(null) }
    val marks = drawing?.waypoints ?: emptyList()
    // How many fingers are on the map, handles included: a second one ends a pick-up or a drag.
    var fingers by remember { mutableIntStateOf(0) }

    // What each overlay source holds, in the properties `overlays.ts` paints from.
    val planJson = remember(plan, drawing) { planJson(plan, drawing) }
    val waypointsJson = remember(drawing, held) { waypointsJson(marks, held) }
    val riddenJson = remember(ridden) { collection(listOfNotNull(lineFeature(ridden))) }
    // The stretch picked out on the profile keeps the colour of the line it is part of, which `role` names.
    val rangeJson = remember(highlight, highlightRidden) {
        collection(listOfNotNull(lineFeature(highlight, properties("role" to if (highlightRidden) "ridden" else "plan"))))
    }
    val cursorJson = remember(marker) { collection(listOfNotNull(marker?.let { pointFeature(it) })) }

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
    val picking = highlight.size > 1
    val currentWaiting by rememberUpdatedState(waiting)

    // A camera the app asked for is on its way: Centre, Show, Overview, or Follow's first step, from wherever the map was.
    var flying by remember { mutableStateOf(false) }
    suspend fun fly(move: suspend () -> Unit) {
        flying = true
        try {
            move()
        } finally {
            flying = false
        }
    }

    // Start where the camera is going when that is known, rather than flying in: every tile a fly-in passes through is
    // one more download, on a phone that may be on a hillside's last bar of signal.
    val initialCamera = remember {
        val at = fix?.at ?: plan.firstOrNull() ?: drawing?.waypoints?.firstOrNull()?.at ?: Coordinate(47.4917, 11.0950)
        when (camera) {
            is MapCamera.Follow -> CameraPosition(
                target = Position(at.lon, at.lat),
                zoom = camera.zoom,
                // Read once, and unobserved: a read here would recompose the map on every heading after it.
                bearing = mapBearing(camera.orientation, fix, Snapshot.withoutReadObservation(heading), previous = 0.0),
            )
            is MapCamera.Overview, MapCamera.Free, is MapCamera.Show -> CameraPosition(target = Position(at.lon, at.lat), zoom = 13.0)
            is MapCamera.Centre -> CameraPosition(target = Position(at.lon, at.lat), zoom = camera.zoom)
        }
    }

    val state = rememberMapState(
        baseStyle = remember(style) { BaseStyle.Json(style.json) },
        initialCameraPosition = initialCamera,
    ) {
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
        state.events.collect {
            if (it is MapEvent.FrameRendered) MapFrames.count++
            if (it == MapEvent.Idle) {
                MapIdles.count++
                currentOnIdle()
            }
        }
    }

    // The overlays are layers of the style (`Overlays.kt`): fed by id once it has loaded, and again whenever it reloads.
    val loaded = state.style.loadState == StyleLoadState.Ready
    Feed(state, loaded, OverlayIds.PLAN_SOURCE, planJson)
    Feed(state, loaded, OverlayIds.PLAN_POINTS_SOURCE, waypointsJson)
    Feed(state, loaded, OverlayIds.RIDDEN_SOURCE, riddenJson)
    Feed(state, loaded, OverlayIds.RANGE_SOURCE, rangeJson)
    Feed(state, loaded, OverlayIds.CURSOR_SOURCE, cursorJson)
    // The rider, carrying the heading the facing cone is turned by. Fed from the fix and the heading as they change
    // rather than from composition, so that a heading recomposes nothing (see TracksMap's `heading`).
    LaunchedEffect(state, loaded) {
        if (!loaded) return@LaunchedEffect
        val rider = checkNotNull((state.style.sources[OverlayIds.RIDER_SOURCE] as? GeoJsonSourceHandle)?.asMutable) {
            "overlays.json has no GeoJSON source '${OverlayIds.RIDER_SOURCE}'"
        }
        snapshotFlow { riderJson(currentFix?.at, currentHeading()) }.collect { rider.setData(GeoJsonData.JsonString(it)) }
    }

    // Held back while a stretch of it is picked out, so the stretch drawn over it reads as *this piece* rather than as a
    // second line.
    Paint(state, loaded, OverlayIds.PLAN_LINE_LAYER, "line-opacity", if (picking && !highlightRidden) HELD_BACK else 1.0)
    Paint(state, loaded, OverlayIds.RIDDEN_LAYER, "line-opacity", if (picking && highlightRidden) HELD_BACK else 1.0)
    Paint(state, loaded, OverlayIds.PLAN_PENDING_LAYER, "line-opacity", routingOpacity)

    val density = LocalDensity.current
    LaunchedEffect(state, loaded) {
        if (!loaded) return@LaunchedEffect
        state.style.layers[OverlayIds.PLAN_PENDING_LAYER]?.asMutable
            ?.setPaintTransition("line-opacity", TransitionOptions(duration = (ROUTING_PERIOD_MS / 2).milliseconds))
        // Where the phone faces: FIELD_OF_VIEW_DEG wide, painted here in the overlays' colour for it, and turned by the
        // layer to the heading each rider feature carries.
        if (state.style.images[OverlayIds.RIDER_FACING_IMAGE] == null) {
            state.style.images.add(OverlayIds.RIDER_FACING_IMAGE, facingCone(style.facingColour, density))
        }
    }

    // Exactly one camera effect, keyed on the state, reading its inputs through snapshotFlow: a new fix every second
    // must not cancel and restart the effect, or the camera never finishes an animation. The camera is acted on when
    // it changes; only Follow also moves with the fixes, always back to its own zoom.
    LaunchedEffect(state) {
        snapshotFlow { currentCamera }.collectLatest { camera ->
            when (camera) {
                is MapCamera.Follow -> {
                    // The heading is read only where it turns the map. Above walking pace the course does, and a
                    // heading read there would cancel and restart the glide for a value mapBearing then discards.
                    // mapBearing itself stays out of the flow: it reads the camera's bearing, which moves on every
                    // frame of a glide, and would make the flow emit on every frame.
                    //
                    // Until one step has landed, the camera may be anywhere — panned away, or north-up a moment ago — so
                    // that step is a flight and drawn at the display's rate; every step after it is a few pixels, capped.
                    var arrived = false
                    snapshotFlow {
                        val fix = currentFix
                        fix to if (compassTurnsMap(camera.orientation, fix)) currentHeading() else null
                    }.collectLatest { (fix, heading) ->
                        if (fix == null) return@collectLatest
                        val zoom = camera.zoom
                        val current = state.cameraPosition.bearing
                        val bearing = steadyBearing(mapBearing(camera.orientation, fix, heading, previous = current), current)
                        val aim = insetTarget(fix.at, zoom, bearing, camera.inset, layoutDirection)
                        val step = suspend {
                            state.animateCameraPosition(
                                CameraPosition(target = Position(aim.lon, aim.lat), zoom = zoom, bearing = bearing),
                                // Measure-only: TRACKS_FOLLOW_MS in place of the product's glide.
                                duration = (MeasureOverrides.followMs ?: FOLLOW_MS).milliseconds,
                            )
                        }
                        if (arrived) {
                            step()
                        } else {
                            fly(step)
                            arrived = true
                        }
                    }
                }
                is MapCamera.Centre -> {
                    val fix = snapshotFlow { currentFix }.filterNotNull().first()
                    val aim = insetTarget(fix.at, camera.zoom, 0.0, camera.inset, layoutDirection)
                    fly {
                        state.animateCameraPosition(
                            CameraPosition(target = Position(aim.lon, aim.lat), zoom = camera.zoom),
                            duration = FLIGHT_MS.milliseconds,
                        )
                    }
                }
                MapCamera.Free -> Unit
                is MapCamera.Show -> {
                    val position = state.cameraPosition
                    val aim = insetTarget(camera.at, position.zoom, position.bearing, camera.inset, layoutDirection)
                    fly { state.animateCameraPosition(position.copy(target = Position(aim.lon, aim.lat)), duration = FLIGHT_MS.milliseconds) }
                }
                is MapCamera.Overview -> if (camera.points.isNotEmpty()) fly {
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

    // Whether anything is moving that would stutter at MAX_FPS. A fling outlives the finger that threw it, so a finger
    // count cannot see it; the camera's own move reason can. Derived, so that the camera starting and stopping every
    // second recomposes nothing unless the answer changes.
    val uncapped by remember(state) {
        derivedStateOf {
            fingers > 0 || flying || currentWaiting ||
                (state.isCameraMoving && state.cameraMoveReason == CameraMoveReason.GESTURE)
        }
    }

    // Measure-only: TRACKS_MAX_FPS in place of MAX_FPS while capped; 0 switches the cap off.
    val measuredCap = remember {
        when (val fps = MeasureOverrides.maxFps) {
            null -> CAPPED
            0 -> RenderOptions.Standard
            else -> RenderOptions { maximumFps = fps }
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
            renderOptions = if (uncapped) RenderOptions.Standard else measuredCap,
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

        pinned?.let { PinnedCard(state, it) }
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
