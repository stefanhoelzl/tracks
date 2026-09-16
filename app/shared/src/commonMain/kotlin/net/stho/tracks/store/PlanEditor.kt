package net.stho.tracks.store

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanFragment
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.legKey
import net.stho.tracks.plan.stretches
import net.stho.tracks.plan.updateWaypoint
import net.stho.tracks.plan.withEnds
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.routing.NoRoutingData

/**
 * One plan being edited, and the legs its edits route.
 *
 * **Only the legs an edit touches route again.** A leg is kept for as long as the waypoints and profile it was routed
 * for are unchanged — however the plan around it moves — so a line checked on the web does not shift because the
 * phone's tiles are a week newer. A leg that changed routes on the device, and a newer edit to the same leg cancels the
 * route in flight: one route per leg, and never for a leg that no longer exists.
 *
 * Every plan it holds is the plan its link carries: an edit is passed through the fragment, so a point dropped on the
 * phone sits where the web will route it from.
 *
 * **Every edit can be undone**, for as long as the editor is open. The history holds plans, not legs: an undo is one more
 * edit, so the legs it changes route again and the rest are kept. A run of typing into one name is one step.
 *
 * Nothing is kept until [save] or [saveAsNew]. Call it from one thread — the UI's.
 */
class PlanEditor(start: StoredPlan, private val router: LegRouting, private val scope: CoroutineScope) {
    data class State(
        val plan: Plan,
        /** One slot per leg; null while it routes, or while there is no data for it. */
        val legs: List<Leg?>,
        /** Legs routing now: drawn as the pulsing beeline. */
        val routing: Set<Int> = emptySet(),
        /** Legs with no tiles on this device. */
        val noData: Set<Int> = emptySet(),
        /** Legs the engine refused for a reason that is not the two points. */
        val errors: Map<Int, String> = emptyMap(),
        /**
         * Whether there is anything worth saving: a plan that differs from the one the editor opened, or legs it opened
         * without and has routed since. Undone back to the opened plan, legs routed again on the phone are not.
         */
        val changed: Boolean = false,
        val canUndo: Boolean = false,
        val canRedo: Boolean = false,
    )

    val id: String = start.id
    private val opened = start

    private var plan = start.plan
    private var legs = start.legs
    private var keys = keysOf(start.plan)

    private val jobs = HashMap<String, Job>()
    private val noData = HashSet<String>()
    private val errors = HashMap<String, String>()

    private val undone = ArrayDeque<Plan>()
    private val redone = ArrayDeque<Plan>()

    /** The name the last edit typed into, while typing into it is still the step on top of [undone]. */
    private var typing: Int? = null

    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        routeMissing()
    }

    /** The plan after an edit — any of `PlanOps`, applied to [State.plan] and [State.legs]. */
    fun update(next: Plan) {
        val linked = PlanFragment.parse(PlanFragment.format(next))
        if (linked == plan) return

        val renaming = renamed(plan, linked)
        if (renaming == null || renaming != typing) {
            undone.addLast(plan)
            if (undone.size > HISTORY) undone.removeFirst()
        }
        typing = renaming
        redone.clear()
        apply(linked)
    }

    /** Back to the plan before the last edit. */
    fun undo() {
        val previous = undone.removeLastOrNull() ?: return
        redone.addLast(plan)
        typing = null
        apply(previous)
    }

    /** Forward again to the plan the last [undo] left. */
    fun redo() {
        val next = redone.removeLastOrNull() ?: return
        undone.addLast(plan)
        typing = null
        apply(next)
    }

    /**
     * A name found for [stop] after it was placed, by a lookup that answers late. It is part of adding the stop rather
     * than an edit of its own, so every step of the history that holds the stop has it: undoing what came after keeps it.
     */
    fun nameFound(stop: Waypoint, name: String) {
        fun named(plan: Plan): Plan {
            val at = plan.waypoints.indexOf(stop)
            return if (at < 0) plan else updateWaypoint(plan, at) { it.copy(name = name) }
        }
        for (history in listOf(undone, redone)) history.indices.forEach { history[it] = named(history[it]) }
        val next = PlanFragment.parse(PlanFragment.format(named(plan)))
        if (next != plan) apply(next)
    }

    private fun apply(linked: Plan) {
        val nextStretches = stretches(linked.waypoints)
        val nextKeys = nextStretches.map { legKey(it, linked.profile) }

        val kept = HashMap<String, Leg>()
        keys.zip(legs).forEach { (key, leg) -> if (leg != null) kept[key] = leg }

        plan = linked
        keys = nextKeys
        legs = nextStretches.mapIndexed { index, stretch -> kept[nextKeys[index]]?.withEnds(stretch.first(), stretch.last()) }

        // A leg that no longer exists is not worth the engine's time; a newer edit to it is a different leg.
        for (key in jobs.keys - nextKeys.toSet()) jobs.remove(key)?.cancel()
        routeMissing()
    }

    /** Stops routing: the editor is being left, or its plan handed to the library. */
    fun close() {
        jobs.values.forEach { it.cancel() }
        jobs.clear()
        publish()
    }

    /** Saves over the plan this editor opened. */
    suspend fun save(library: PlanLibrary): StoredPlan {
        close()
        return library.save(id, plan, legs)
    }

    /** Saves as a new plan: Copy, which leaves the opened one as it was. */
    suspend fun saveAsNew(library: PlanLibrary): StoredPlan {
        close()
        return library.saveAsNew(plan, legs)
    }

    /** Which name [to] only retypes from [from]: [PLAN_NAME], a waypoint's index, or null when the edit is more than that. */
    private fun renamed(from: Plan, to: Plan): Int? {
        if (from.copy(name = to.name) == to) return PLAN_NAME
        if (from.name != to.name || from.profile != to.profile || from.waypoints.size != to.waypoints.size) return null
        val differing = from.waypoints.indices.filter { from.waypoints[it] != to.waypoints[it] }
        val at = differing.singleOrNull() ?: return null
        return at.takeIf { from.waypoints[at].copy(name = to.waypoints[at].name) == to.waypoints[at] }
    }

    private fun keysOf(plan: Plan) = stretches(plan.waypoints).map { legKey(it, plan.profile) }

    private fun routeMissing() {
        val current = stretches(plan.waypoints)
        for ((index, key) in keys.withIndex()) {
            if (legs[index] != null || key in jobs || key in noData || key in errors) continue
            val stretch = current[index]
            val profile = plan.profile

            // Started once it is in the map, so the job can always find itself there when it finishes.
            val job = scope.launch(start = CoroutineStart.LAZY) {
                try {
                    val leg = router.route(stretch, profile)
                    val at = keys.indexOf(key)
                    if (at >= 0) legs = legs.toMutableList().also { it[at] = leg }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: NoRoutingData) {
                    noData += key
                } catch (e: Exception) {
                    errors[key] = e.message ?: "the router failed"
                } finally {
                    if (jobs[key] === coroutineContext[Job]) jobs.remove(key)
                    publish()
                }
            }
            jobs[key] = job
            job.start()
        }
        publish()
    }

    private fun publish() {
        _state.value = snapshot()
    }

    private fun snapshot() = State(
        plan = plan,
        legs = legs,
        routing = keys.indices.filter { keys[it] in jobs }.toSet(),
        noData = keys.indices.filter { keys[it] in noData }.toSet(),
        errors = keys.indices.mapNotNull { index -> errors[keys[index]]?.let { index to it } }.toMap(),
        changed = plan != opened.plan || legs.indices.any { opened.legs[it] == null && legs[it] != null },
        canUndo = undone.isNotEmpty(),
        canRedo = redone.isNotEmpty(),
    )

    private companion object {
        /** Steps an undo can go back; the oldest drop off. */
        const val HISTORY = 100
        const val PLAN_NAME = -1
    }
}
