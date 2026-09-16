package net.stho.tracks.ui.riding

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import net.stho.tracks.riding.Follower
import net.stho.tracks.riding.Progress
import net.stho.tracks.riding.Route
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.sensors.Sensors

/** The plan a ride follows, measured: the route laid out, and where along it the last fix was — null before one. */
data class Navigation(val plan: StoredPlan, val route: Route, val progress: Progress?)

/**
 * Where a ride stands along the plan it follows, from the fixes [sensors] deliver.
 *
 * Kept outside the screen, so that whatever else shows the readouts reads the same ones. The plan is looked up in
 * [plans] by id and followed as it changes: a leg that finishes routing, an edit saved, lays the route out again, and
 * the position is matched again on it rather than started over.
 *
 * [scope] must be the UI's: it reads the plans the library publishes there.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Navigator(private val sensors: Sensors, plans: StateFlow<List<StoredPlan>>, scope: CoroutineScope) {
    private val planId = MutableStateFlow<String?>(null)
    private val mutableState = MutableStateFlow<Navigation?>(null)

    /** Null while no plan is followed, or the one followed is not in the library. */
    val state: StateFlow<Navigation?> = mutableState.asStateFlow()

    init {
        scope.launch {
            var follower: Follower? = null
            var followed: String? = null
            combine(planId, plans) { id, all -> id?.let { wanted -> all.firstOrNull { it.id == wanted } } }
                // A plan is laid out again when what it is changes, not whenever the list is published.
                .distinctUntilChanged { a, b -> a?.id == b?.id && a?.plan == b?.plan && a?.legs == b?.legs }
                .collectLatest { stored ->
                    if (stored == null) {
                        follower = null
                        followed = null
                        mutableState.value = null
                        return@collectLatest
                    }
                    val route = Route(stored.plan.waypoints, stored.legs)
                    val current = follower?.takeIf { followed == stored.id }?.also { it.reroute(route) } ?: Follower(route)
                    follower = current
                    followed = stored.id
                    mutableState.value = Navigation(stored, route, current.progress())
                    sensors.fixes.collect { fix -> mutableState.value = Navigation(stored, route, current.follow(fix.at)) }
                }
        }
    }

    /** Follows the plan [id]; null follows none. */
    fun follow(id: String?) {
        planId.value = id
    }
}
