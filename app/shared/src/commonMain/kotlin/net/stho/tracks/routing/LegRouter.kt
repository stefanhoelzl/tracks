package net.stho.tracks.routing

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.stho.tracks.brouter.RouteCancel
import net.stho.tracks.brouter.RouteCancelled
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.Waypoint

/** Routes one leg of a plan: its POI-to-POI stretch, on one profile. */
fun interface LegRouting {
    /** Throws [NoRoutingData] when there are no tiles for it here, and [RouterError] when the engine is refusing. */
    suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg
}

/**
 * The on-device router, for coroutines.
 *
 * A leg takes seconds — about 11 s for 176 km and 25 s for 306 km on a hot phone — so it runs on [dispatcher], never
 * the caller's thread, and one at a time, since the engine is one. Cancelling the coroutine stops the engine rather
 * than waiting it out, so a newer edit to the same leg gets the engine within moments.
 *
 * [dispatcher] is the caller's to choose: a thread that may block for half a minute (`Dispatchers.IO`).
 */
class LegRouter(
    private val segmentDir: String,
    private val profileDir: String,
    private val dispatcher: CoroutineDispatcher,
) : LegRouting {
    private val engine = Mutex()

    /** Throws [NoRoutingData] when the device has no tiles for the leg; see [OnDeviceRouter.leg]. */
    override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg = engine.withLock {
        coroutineScope {
            val cancel = RouteCancel()
            val routing = async(dispatcher) {
                try {
                    OnDeviceRouter.leg(segmentDir, profileDir, stretch, profile, cancel)
                } catch (e: RouteCancelled) {
                    // Only ever because this coroutine was cancelled: say so in the coroutine's own terms, or the
                    // engine's exception would escape a scope that is already being torn down.
                    throw CancellationException(e.message)
                }
            }
            try {
                routing.await()
            } catch (e: CancellationException) {
                cancel.cancel()
                throw e
            }
        }
    }
}
