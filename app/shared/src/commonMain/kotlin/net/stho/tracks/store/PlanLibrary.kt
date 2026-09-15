package net.stho.tracks.store

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanFragment
import net.stho.tracks.plan.stretches
import net.stho.tracks.routing.LegRouting
import net.stho.tracks.routing.NoRoutingData

/** Where a stored plan's routing stands. */
data class PlanRouting(
    /** The leg the engine is on now, if any. */
    val routing: Int? = null,
    /** Legs with no tiles on this device yet. They route when the plans are next [PlanLibrary.start]ed. */
    val noData: Set<Int> = emptySet(),
    /** Legs the engine refused for a reason that is not the two points: said, never drawn as an unroutable leg. */
    val errors: Map<Int, String> = emptyMap(),
)

/**
 * The plans on this phone, and the routing that fills in their legs.
 *
 * A plan that arrives is kept at once, with no legs, and then routed a leg at a time on the device: loading never waits
 * for the engine, and a plan whose area has no tiles yet is still a plan in the list. Each leg is saved as it lands, so
 * an app killed halfway through a 300 km plan keeps what it had.
 *
 * Call it from one thread — the UI's. [io] is where files are read and written.
 */
class PlanLibrary(
    private val store: PlanStore,
    private val router: LegRouting,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val now: () -> Long,
    private val newId: () -> String = { PlanStore.newId() },
) {
    private val _plans = MutableStateFlow<List<StoredPlan>>(emptyList())

    /** Newest first. */
    val plans: StateFlow<List<StoredPlan>> = _plans.asStateFlow()

    private val _routing = MutableStateFlow<Map<String, PlanRouting>>(emptyMap())

    /** By plan id; a plan with nothing to say about its routing has no entry. */
    val routing: StateFlow<Map<String, PlanRouting>> = _routing.asStateFlow()

    private val jobs = HashMap<String, Job>()

    /** Reads what is on disk, and routes whatever legs are still missing. */
    suspend fun start() {
        _plans.value = withContext(io) { store.list() }
        for (plan in _plans.value) routeMissing(plan.id)
    }

    /**
     * A plan arrives. It is kept as its link carries it — coordinates at the link's precision, so the legs the phone
     * routes are the legs the web will route from the same link — and it never starts anything but routing.
     */
    suspend fun receive(plan: Plan): StoredPlan {
        val linked = PlanFragment.parse(PlanFragment.format(plan))
        val stored = StoredPlan(newId(), now(), linked, List(stretches(linked.waypoints).size) { null })
        write(stored)
        routeMissing(stored.id)
        return stored
    }

    /** The same plan and legs under a new id, so the original survives what is done to the copy. */
    suspend fun copy(id: String): StoredPlan? {
        val source = find(id) ?: return null
        val copy = source.copy(id = newId(), savedAtMillis = now())
        write(copy)
        routeMissing(copy.id)
        return copy
    }

    /**
     * Saves an edited plan over [id], newest again; whatever legs it still lacks route here from now on. [plan] must
     * already be as its link carries it, which an editor's plan always is.
     */
    suspend fun save(id: String, plan: Plan, legs: List<Leg?>): StoredPlan {
        val stored = StoredPlan(id, now(), plan, legs)
        write(stored)
        routeMissing(id)
        return stored
    }

    /** Saves an edited plan as a new one, leaving the plan it was edited from as it was. */
    suspend fun saveAsNew(plan: Plan, legs: List<Leg?>): StoredPlan = save(newId(), plan, legs)

    suspend fun delete(id: String) {
        jobs.remove(id)?.cancelAndJoin()
        withContext(io) { store.delete(id) }
        _plans.update { plans -> plans.filterNot { it.id == id } }
        _routing.update { it - id }
    }

    fun find(id: String): StoredPlan? = _plans.value.firstOrNull { it.id == id }

    private suspend fun write(stored: StoredPlan) {
        withContext(io) { store.save(stored) }
        _plans.update { plans ->
            (plans.filterNot { it.id == stored.id } + stored)
                .sortedWith(compareByDescending<StoredPlan> { it.savedAtMillis }.thenBy { it.id })
        }
    }

    private fun status(id: String, change: (PlanRouting) -> PlanRouting) = _routing.update { all ->
        val next = change(all[id] ?: PlanRouting())
        if (next == PlanRouting()) all - id else all + (id to next)
    }

    private fun routeMissing(id: String) {
        jobs.remove(id)?.cancel()
        val plan = find(id) ?: return
        if (plan.legs.none { it == null }) return

        jobs[id] = scope.launch {
            status(id) { PlanRouting() }
            try {
                for ((index, stretch) in stretches(plan.plan.waypoints).withIndex()) {
                    if (plan.legs.getOrNull(index) != null) continue
                    status(id) { it.copy(routing = index) }

                    val leg = try {
                        router.route(stretch, plan.plan.profile)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: NoRoutingData) {
                        status(id) { it.copy(noData = it.noData + index) }
                        continue
                    } catch (e: Exception) {
                        status(id) { it.copy(errors = it.errors + (index to (e.message ?: "the router failed"))) }
                        continue
                    }

                    // Whatever is stored now, not what was stored when this began: other legs may have landed since.
                    val current = find(id) ?: return@launch
                    if (current.plan != plan.plan) return@launch
                    write(current.copy(legs = current.legs.toMutableList().also { it[index] = leg }))
                }
            } finally {
                status(id) { it.copy(routing = null) }
            }
        }
    }
}
