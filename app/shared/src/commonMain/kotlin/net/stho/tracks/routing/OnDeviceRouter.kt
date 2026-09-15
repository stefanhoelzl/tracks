package net.stho.tracks.routing

import net.stho.tracks.brouter.BRouter

/**
 * BRouter, on this device: the engine the web asks brouter.de for, converted, over `rd5` tiles on disk.
 *
 * It lives here rather than in `:brouter` so the iOS framework exports this and nothing of BRouter's own
 * public surface — hundreds of converted classes nobody on the Swift side should call. M12 builds the
 * plan editor on top of it; in M10 it is what the iOS shell measures.
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
}
