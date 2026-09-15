package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import kotlin.math.max
import kotlin.math.min

/*
 * Editing a plan, from `packages/web/src/lib/plan-ops.ts`: pure functions that produce the next plan, so the phone's
 * editor places, moves and re-kinds waypoints by exactly the web's rules. Pinned by `plan-edit.json`.
 */

/** Where a new waypoint goes. ROUTING only ever takes [Nearest]; POI is offered all three. */
enum class Placement { Nearest, Start, End }

/** The indices, in waypoint order, of the POIs that bound the legs. */
fun poiIndices(waypoints: List<Waypoint>): List<Int> = waypoints.indices.filter { waypoints[it].kind == WaypointKind.Poi }

/** What the plan is, when nobody has named it — its two ends. Empty below two stops. */
fun derivedName(plan: Plan): String {
    val stops = plan.waypoints.filter { it.kind == WaypointKind.Poi }
    if (stops.size < 2) return ""
    return "${stops.first().name ?: "Start"} → ${stops.last().name ?: "End"}"
}

/** One fewer than the POIs, and zero until there are two. */
fun legCount(plan: Plan): Int = max(0, poiIndices(plan.waypoints).size - 1)

/**
 * Which leg a tap meant: the nearest one, measured against the line that is drawn, routed or not. Null only when there
 * is no leg yet.
 */
fun nearestLeg(plan: Plan, legs: List<Leg?>, at: Coordinate): Int? {
    var best: Int? = null
    var bestDistance = Double.POSITIVE_INFINITY

    legGeometries(plan.waypoints, legs).forEachIndexed { index, coordinates ->
        val distanceM = nearestOnPath(coordinates, at.lon, at.lat).distanceM
        if (distanceM < bestDistance) {
            bestDistance = distanceM
            best = index
        }
    }

    return best
}

/**
 * Where inside leg [legIndex] a point belongs, as an index into the waypoints: ordered by how far along the drawn line
 * it sits among the shaping points already there, so the route never doubles back through them.
 */
fun insertionAt(plan: Plan, legs: List<Leg?>, legIndex: Int, at: Coordinate): Int {
    val pois = poiIndices(plan.waypoints)
    val opens = pois.getOrNull(legIndex)
    val closes = pois.getOrNull(legIndex + 1)
    if (opens == null || closes == null) return plan.waypoints.size

    val coordinates = legGeometries(plan.waypoints, legs).getOrNull(legIndex)
    if (coordinates == null || coordinates.size < 2) return closes

    fun along(lat: Double, lon: Double) = nearestOnPath(coordinates, lon, lat).position
    val target = along(at.lat, at.lon)

    for (index in opens + 1 until closes) {
        val waypoint = plan.waypoints[index]
        if (along(waypoint.lat, waypoint.lon) > target) return index
    }
    return closes
}

/** How a leg reads in the dialog: the two stops it runs between. */
fun legLabel(plan: Plan, legIndex: Int): String? {
    val pois = plan.waypoints.filter { it.kind == WaypointKind.Poi }
    val from = pois.getOrNull(legIndex) ?: return null
    val to = pois.getOrNull(legIndex + 1) ?: return null
    return "${from.name ?: "stop"} → ${to.name ?: "stop"}"
}

/** Resolves the dialog's placement choice to one index. */
fun placementAt(plan: Plan, legs: List<Leg?>, placement: Placement, legIndex: Int?, at: Coordinate): Int = when (placement) {
    Placement.Start -> 0
    Placement.End -> plan.waypoints.size
    Placement.Nearest -> if (legIndex == null) plan.waypoints.size else insertionAt(plan, legs, legIndex, at)
}

fun addWaypoint(plan: Plan, waypoint: Waypoint, index: Int): Plan {
    val waypoints = plan.waypoints.toMutableList()
    waypoints.add(max(0, min(index, waypoints.size)), waypoint)
    return plan.copy(waypoints = waypoints)
}

fun removeWaypoint(plan: Plan, index: Int): Plan =
    plan.copy(waypoints = plan.waypoints.filterIndexed { at, _ -> at != index })

fun updateWaypoint(plan: Plan, index: Int, change: (Waypoint) -> Waypoint): Plan =
    plan.copy(waypoints = plan.waypoints.mapIndexed { at, waypoint -> if (at == index) change(waypoint) else waypoint })

/**
 * Changing a kind, which can never leave a plan with fewer than two POIs. Demoting a stop drops its name: a shaping
 * point has nothing to be called.
 */
fun setKind(plan: Plan, index: Int, kind: WaypointKind): Plan {
    val next = updateWaypoint(plan, index) {
        it.copy(kind = kind, name = if (kind == WaypointKind.Routing) null else it.name)
    }
    return if (poiIndices(next.waypoints).size < 2) plan else next
}

fun moveWaypoint(plan: Plan, index: Int, at: Coordinate): Plan =
    updateWaypoint(plan, index) { it.copy(lat = at.lat, lon = at.lon) }

/** The first two waypoints are the start and the end, with no choice of kind. */
fun kindIsAChoice(plan: Plan): Boolean = plan.waypoints.size >= 2

/**
 * A stop and the shaping points that lead out of it, moved as one. [from] and [to] are POI ordinals, as the list shows
 * them; shaping points before the first POI stay where they are.
 */
fun moveStop(plan: Plan, from: Int, to: Int): Plan {
    val head = ArrayList<Waypoint>()
    val blocks = ArrayList<MutableList<Waypoint>>()

    for (waypoint in plan.waypoints) {
        when {
            waypoint.kind == WaypointKind.Poi -> blocks.add(mutableListOf(waypoint))
            blocks.isEmpty() -> head.add(waypoint)
            else -> blocks.last().add(waypoint)
        }
    }

    val block = blocks.getOrNull(from)
    if (block == null || from == to || to < 0 || to >= blocks.size) return plan

    val next = blocks.toMutableList<List<Waypoint>>()
    next.removeAt(from)
    next.add(to, block)
    return plan.copy(waypoints = head + next.flatten())
}
