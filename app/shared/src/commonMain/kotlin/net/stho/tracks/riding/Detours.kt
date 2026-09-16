package net.stho.tracks.riding

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanFragment
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.addWaypoint
import net.stho.tracks.plan.insertionAt
import net.stho.tracks.plan.legKey
import net.stho.tracks.plan.stretches
import net.stho.tracks.plan.withEnds
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.StoredPlan

/** What a long press on the riding map can make of a place. */
enum class Detour {
    /** A shaping point in the leg you are on: the route goes through it on the way to the same next stop. */
    Through,

    /** A stop in the leg you are on: it becomes the next stop. */
    Stop,

    /** A new finish after the old one, which stays a stop. */
    End,
}

/**
 * The plan with a [detour] through [at]: into leg [leg] — the one you are on — for [Detour.Through] and [Detour.Stop],
 * after the finish for [Detour.End]. [name] names a stop, when the map had one for the place. Unchanged when there is
 * no leg to go into.
 */
fun detour(plan: Plan, legs: List<Leg?>, leg: Int?, at: Coordinate, detour: Detour, name: String?): Plan = when (detour) {
    Detour.Through -> leg?.let { addWaypoint(plan, Waypoint(at.lat, at.lon, WaypointKind.Routing, null), insertionAt(plan, legs, it, at)) } ?: plan
    Detour.Stop -> leg?.let { addWaypoint(plan, Waypoint(at.lat, at.lon, WaypointKind.Poi, name), insertionAt(plan, legs, it, at)) } ?: plan
    Detour.End -> addWaypoint(plan, Waypoint(at.lat, at.lon, WaypointKind.Poi, name), plan.waypoints.size)
}

/**
 * The edits made to a plan while riding it, each saved over the stored plan at once — recording never waits, and a ride
 * the app dies during continues on the plan as it was changed. Its legs route where the library routes them, online
 * first, while the map draws them pulsing.
 *
 * **Every edit can be undone**, for as long as the ride follows this plan. A leg routed for any plan this has saved is
 * kept, so taking back a detour is the plan as it was at once, with nothing to route again.
 *
 * Call it from one thread — the UI's.
 */
class RideEdits(private val library: PlanLibrary, val planId: String) {
    data class State(val canUndo: Boolean = false, val canRedo: Boolean = false)

    private val undone = ArrayDeque<Plan>()
    private val redone = ArrayDeque<Plan>()
    private val known = HashMap<String, Leg>()

    private val mutableState = MutableStateFlow(State())
    val state: StateFlow<State> = mutableState.asStateFlow()

    /** Saves [next] over the plan. */
    suspend fun update(next: Plan) {
        val current = library.find(planId) ?: return
        val linked = PlanFragment.parse(PlanFragment.format(next))
        if (linked == current.plan) return
        undone.addLast(current.plan)
        redone.clear()
        save(current, linked)
    }

    /** The plan was saved over by something else — the editor — from [previous]: a step to undo like the rest. */
    fun edited(previous: StoredPlan) {
        remember(previous)
        undone.addLast(previous.plan)
        redone.clear()
        publish()
    }

    /**
     * A name found for [stop] after it was placed, by a lookup that answers late: part of placing it, not an edit of its
     * own, so every plan in the history that holds the stop has it too. Nothing routes: a name does not move a line.
     *
     * Saved once no leg of the plan is routing: a leg lands only on the plan it was routed for, and a rename saved under
     * it would send it back to the router.
     */
    suspend fun nameFound(stop: Waypoint, name: String) {
        fun named(plan: Plan): Plan {
            val at = plan.waypoints.indexOf(stop)
            return if (at < 0) plan else plan.copy(waypoints = plan.waypoints.toMutableList().also { it[at] = stop.copy(name = name) })
        }
        for (history in listOf(undone, redone)) history.indices.forEach { history[it] = named(history[it]) }
        library.routing.first { it[planId]?.routing == null }
        val current = library.find(planId) ?: return
        val next = named(current.plan)
        if (next != current.plan) library.save(planId, next, current.legs)
    }

    suspend fun undo() {
        val current = library.find(planId) ?: return
        val previous = undone.removeLastOrNull() ?: return
        redone.addLast(current.plan)
        save(current, previous)
    }

    suspend fun redo() {
        val current = library.find(planId) ?: return
        val next = redone.removeLastOrNull() ?: return
        undone.addLast(current.plan)
        save(current, next)
    }

    private suspend fun save(current: StoredPlan, next: Plan) {
        remember(current)
        val legs = stretches(next.waypoints).map { stretch -> known[legKey(stretch, next.profile)]?.withEnds(stretch.first(), stretch.last()) }
        publish()
        library.save(planId, next, legs)
    }

    private fun remember(stored: StoredPlan) {
        stretches(stored.plan.waypoints).forEachIndexed { index, stretch ->
            stored.legs.getOrNull(index)?.let { known[legKey(stretch, stored.plan.profile)] = it }
        }
    }

    private fun publish() {
        mutableState.value = State(canUndo = undone.isNotEmpty(), canRedo = redone.isNotEmpty())
    }
}
