package net.stho.tracks.routing

import net.stho.tracks.brouter.BRouter
import net.stho.tracks.brouter.MissingSegmentException
import net.stho.tracks.brouter.RouteCancel
import net.stho.tracks.brouter.RoutingException
import net.stho.tracks.codec.jsTrim
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.Waypoint

/**
 * BRouter, on this device: the engine the web asks brouter.de for, converted, over `rd5` tiles on disk.
 *
 * It lives here rather than in `:brouter` so the iOS framework exports this and nothing of BRouter's own
 * public surface — hundreds of converted classes nobody on the Swift side should call. It is the only router the app
 * has: a plan is routed here when it arrives, and its edited legs are routed here again.
 */
object OnDeviceRouter {
    val engineVersion: String get() = BRouter.VERSION

    /**
     * Routes one leg the way brouter.de would answer the web's request, and returns its GeoJSON.
     * Blocks, so never call it on the main thread. Throws when BRouter cannot route it.
     */
    @Throws(Exception::class)
    fun route(segmentDir: String, profileDir: String, profile: String, lonlats: String): String =
        BRouter.route(segmentDir, profileDir, profile, lonlats)

    /**
     * Routes one POI-to-POI stretch of a plan, with its shaping points, into a [Leg].
     *
     * Two points BRouter cannot connect are a [FailedLeg], as a 400 from brouter.de is on the web. A tile that is not
     * on the device is [NoRoutingData] instead: that says nothing about the two points. [cancel] stops it early, and
     * it then throws [net.stho.tracks.brouter.RouteCancelled].
     *
     * Blocks, and one route runs at a time — BRouter's profile directory is process-wide. [LegRouter] does both for
     * callers in coroutines.
     */
    @Throws(Exception::class)
    fun leg(segmentDir: String, profileDir: String, stretch: List<Waypoint>, profile: Profile, cancel: RouteCancel?): Leg {
        val from = stretch.firstOrNull()
        val to = stretch.lastOrNull()
        if (from == null || to == null || stretch.size < 2) throw RouterError("a leg needs two ends")

        val geojson = try {
            BRouter.route(
                segmentDir = segmentDir,
                profileDir = profileDir,
                profile = BRouterWire.profileFile(profile),
                lonlats = BRouterWire.lonlats(stretch),
                cancel = cancel,
            )
        } catch (e: MissingSegmentException) {
            throw NoRoutingData(e.file.substringAfterLast('/'))
        } catch (e: RoutingException) {
            return FailedLeg(from, to, jsTrim(e.message ?: "").ifEmpty { "No route found" })
        }

        return BRouterWire.leg(from, to, geojson)
    }
}
