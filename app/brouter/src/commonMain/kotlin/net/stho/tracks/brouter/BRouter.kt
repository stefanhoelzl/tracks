package net.stho.tracks.brouter

import btools.kmp.io.File
import btools.router.FormatJson
import btools.router.RoutingContext
import btools.router.RoutingEngine
import btools.router.RoutingParamCollector
import kotlin.concurrent.atomics.AtomicBoolean
import kotlin.concurrent.atomics.AtomicReference
import kotlin.concurrent.atomics.ExperimentalAtomicApi

/** BRouter could not route the request: the message brouter.de answers a 400 with. */
class RoutingException(message: String) : Exception(message)

/**
 * A tile the route needs is not in the segment directory.
 *
 * Not a [RoutingException]: brouter.de has every tile, so this is never something it would answer. It says the
 * phone has no data here yet, which is a fact about the device rather than about the two points.
 */
class MissingSegmentException(val file: String) : Exception("datafile $file not found")

/** The route was stopped by its [RouteCancel] before it finished. */
class RouteCancelled : Exception("the route was cancelled")

/**
 * Stops a route in progress, from any thread.
 *
 * The engine checks at every step of its search, so a long route stops within moments rather than running on for
 * the twenty seconds a hot phone needs — and the one engine the app has is free for the next edit.
 */
@OptIn(ExperimentalAtomicApi::class)
class RouteCancel {
    private val cancelled = AtomicBoolean(false)
    private val engine = AtomicReference<RoutingEngine?>(null)

    val isCancelled: Boolean get() = cancelled.load()

    fun cancel() {
        cancelled.store(true)
        engine.load()?.terminate()
    }

    // Each side writes before it reads what the other wrote, so a cancel racing the start is never lost.
    internal fun attach(routing: RoutingEngine) {
        engine.store(routing)
        if (cancelled.load()) routing.terminate()
    }
}

private val MISSING_SEGMENT = Regex("datafile (.+) not found")

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
     * @param cancel stops the route from another thread; it then throws [RouteCancelled].
     */
    fun route(
        segmentDir: String,
        profileDir: String,
        profile: String,
        lonlats: String,
        memoryclass: Int = 128,
        cancel: RouteCancel? = null,
    ): String {
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
        cancel?.attach(engine)
        if (cancel?.isCancelled == true) throw RouteCancelled()
        engine.doRun(0)
        if (cancel?.isCancelled == true) throw RouteCancelled()
        engine.errorMessage?.let { message ->
            MISSING_SEGMENT.matchEntire(message)?.let { throw MissingSegmentException(it.groupValues[1]) }
            throw RoutingException(message)
        }

        val track = engine.getFoundTrack()
        // ServerHandler.getTrackName: brouter_<profile>_<alternativeidx>
        track.name = "brouter_${profile}_0"
        return FormatJson(context).format(track) ?: throw RoutingException("no output")
    }
}
