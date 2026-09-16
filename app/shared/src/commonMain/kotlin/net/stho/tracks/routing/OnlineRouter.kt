package net.stho.tracks.routing

import kotlinx.coroutines.CancellationException
import net.stho.tracks.codec.jsTrim
import net.stho.tracks.places.Http
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.FormUrlEncoded
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.Waypoint

/** brouter.de could not be reached, or answered as a server in trouble: a fact about the server, not about the leg. */
class RouterUnreachable(message: String) : RouterError(message)

/**
 * BRouter at brouter.de, asked exactly as the web asks it (`packages/routing/src/brouter/index.ts`): the same parameters
 * in the same order, the same reading of the answer. A 400 is the engine saying these two points cannot be connected,
 * which is a [FailedLeg]; anything else that is not a track is the server's trouble, [RouterUnreachable].
 */
class BRouterDe(private val http: Http, private val endpoint: String = ENDPOINT) : LegRouting {
    override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
        val from = stretch.firstOrNull()
        val to = stretch.lastOrNull()
        if (from == null || to == null || stretch.size < 2) throw RouterError("a leg needs two ends")

        val response = try {
            http.get("$endpoint?${params(stretch, profile)}")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw RouterUnreachable("Could not reach brouter.de")
        }
        if (!response.ok) {
            val body = jsTrim(response.body)
            if (response.status == 400) return FailedLeg(from, to, body.ifEmpty { "No route found" })
            throw RouterUnreachable(body.ifEmpty { "BRouter returned ${response.status}" })
        }
        return BRouterWire.leg(from, to, response.body)
    }

    companion object {
        const val ENDPOINT = "https://brouter.de/brouter"

        /** The web's `URLSearchParams`, in its order. */
        internal fun params(stretch: List<Waypoint>, profile: Profile): String = FormUrlEncoded.serialize(
            listOf(
                "lonlats" to BRouterWire.lonlats(stretch),
                "profile" to BRouterWire.profileFile(profile),
                "alternativeidx" to "0",
                "format" to "geojson",
            ),
        )
    }
}

/**
 * Routes on brouter.de while the phone is online, and on the device when it is not — or when brouter.de cannot be
 * reached or is in trouble.
 *
 * Online, a leg can be routed anywhere, as on the web, and is the web's own answer. Offline, the device routes over the
 * tiles offline data keeps, with the same engine and profiles, so a re-plan with no signal is the leg the web would draw
 * from the same tiles.
 */
class OnlineFirstRouter(
    private val online: LegRouting,
    private val onDevice: LegRouting,
    private val isOnline: () -> Boolean,
) : LegRouting {
    override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
        if (isOnline()) {
            try {
                return online.route(stretch, profile)
            } catch (e: RouterUnreachable) {
                // A dead zone the system has not noticed yet, or brouter.de busy: the device can still answer.
            }
        }
        return onDevice.route(stretch, profile)
    }
}
