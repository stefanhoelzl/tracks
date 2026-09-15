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
import net.stho.tracks.plan.legKey
import net.stho.tracks.plan.stretches
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
        /** Whether anything differs from the plan the editor opened. */
        val changed: Boolean = false,
    )

    val id: String = start.id
    private val opened = start

    private var plan = start.plan
    private var legs = start.legs
    private var keys = keysOf(start.plan)

    private val jobs = HashMap<String, Job>()
    private val noData = HashSet<String>()
    private val errors = HashMap<String, String>()

    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        routeMissing()
    }

    /** The plan after an edit — any of `PlanOps`, applied to [State.plan] and [State.legs]. */
    fun update(next: Plan) {
        val linked = PlanFragment.parse(PlanFragment.format(next))
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
        changed = plan != opened.plan || legs != opened.legs,
    )
}
