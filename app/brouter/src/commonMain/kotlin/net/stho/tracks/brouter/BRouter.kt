package net.stho.tracks.brouter

import btools.kmp.io.File
import btools.router.FormatJson
import btools.router.RoutingContext
import btools.router.RoutingEngine
import btools.router.RoutingParamCollector

/** BRouter could not route the request: the message brouter.de answers a 400 with. */
class RoutingException(message: String) : Exception(message)

/**
 * The converted engine, called the way brouter.de's server calls it for the request the web
 * sends — `?lonlats=…&profile=…&alternativeidx=0&format=geojson` — so that what comes back is
 * the same GeoJSON, byte for byte, apart from `creator`.
 *
 * Routes on the calling thread and blocks. One route at a time: the engine's `synchronized` is
 * a no-op on Native, and `profileBaseDir` is process-wide.
 */
object BRouter {
    const val VERSION = "1.7.10"

    /**
     * @param segmentDir the directory holding the `rd5` tiles the route touches.
     * @param profileDir the directory holding `<profile>.brf` and `lookups.dat`.
     * @param profile BRouter's profile name (`trekking`, `fastbike`, …), not the app's word.
     * @param lonlats BRouter's own grammar: `lon,lat[,name]` joined by `|`.
     * @param memoryclass the engine's memory budget in MB; 128 is brouter.de's.
     */
    fun route(segmentDir: String, profileDir: String, profile: String, lonlats: String, memoryclass: Int = 128): String {
        btools.kmp.System.setProperty("profileBaseDir", profileDir)

        val context = RoutingContext()
        context.memoryclass = memoryclass
        context.localFunction = profile

        val collector = RoutingParamCollector()
        val waypoints = collector.getWayPointList(lonlats)
        val params = HashMap<String?, String?>()
        params["lonlats"] = lonlats
        params["alternativeidx"] = "0"
        params["format"] = "geojson"
        collector.setParams(context, waypoints, params)

        val engine = RoutingEngine(null, null, File(segmentDir), waypoints, context, 0)
        engine.quite = true
        engine.doRun(0)
        engine.errorMessage?.let { throw RoutingException(it) }

        val track = engine.getFoundTrack()
        // ServerHandler.getTrackName: brouter_<profile>_<alternativeidx>
        track.name = "brouter_${profile}_0"
        return FormatJson(context).format(track) ?: throw RoutingException("no output")
    }
}
