package net.stho.tracks.desktop

import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanLink
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.routing.LegRouter
import net.stho.tracks.store.PlanLibrary
import net.stho.tracks.store.PlanStore
import net.stho.tracks.ui.Intake
import net.stho.tracks.ui.receiveLink
import okio.FileSystem
import okio.Path.Companion.toPath

/**
 * Writes the plans the screenshot scenes draw: plan links, taken in as a paste is and routed by the real engine over
 * BRouter's parity snapshot. The scenes then only read them, so CI needs no tiles to route with.
 *
 *     ./gradlew :desktopApp:recordPlans
 *
 * Around Garmisch, inside the map tiles the scenes have: one plan routed, one unnamed, one with a leg the engine
 * cannot connect, and one somewhere this device has no routing data for.
 *
 * Beside them, in `riding`, the plan the riding scenes follow: the bundled ride's own 6 km out of Garmisch, with a stop
 * where it stops. Kept apart so the plan list the other scenes draw stays as it is.
 */
fun main(args: Array<String>) {
    val (out, segments, profiles) = args
    val ridingOut = File(out).resolveSibling("riding").path
    File(out).deleteRecursively()
    File(ridingOut).deleteRecursively()

    fun stop(lat: Double, lon: Double, name: String?) = Waypoint(lat, lon, WaypointKind.Poi, name)
    fun hint(lat: Double, lon: Double) = Waypoint(lat, lon, WaypointKind.Routing, null)
    val links = listOf(
        Plan(
            name = "Partnachklamm",
            profile = Profile.Hiking,
            waypoints = listOf(stop(47.4917, 11.0950, "Garmisch"), hint(47.4800, 11.1100), stop(47.4700, 11.1210, "Skistadion"), stop(47.4560, 11.1420, "Partnachalm")),
        ),
        Plan(profile = Profile.Gravel, waypoints = listOf(stop(47.4917, 11.0950, null), stop(47.5200, 11.1400, null))),
        Plan(name = "Over the glacier", waypoints = listOf(stop(47.6546, 9.4797, "Friedrichshafen"), stop(46.5, 8.03, null))),
        Plan(name = "Somewhere new", profile = Profile.Road, waypoints = listOf(stop(41.3275, 19.8187, "Tirana"), stop(41.0, 20.0, null))),
    ).map(PlanLink::format)
    val riding = PlanLink.format(
        Plan(
            name = "Out of Garmisch",
            profile = Profile.Trekking,
            waypoints = listOf(stop(47.491684, 11.094945, "Garmisch"), stop(47.488206, 11.122374, null), stop(47.488902, 11.166775, "Kaltenbrunn")),
        ),
    )

    var ids = 0
    var clock = 1_758_000_000_000L
    runBlocking {
        val library = PlanLibrary(
            store = PlanStore(out.toPath(), FileSystem.SYSTEM),
            router = LegRouter(segments, profiles, Dispatchers.IO),
            scope = this,
            io = Dispatchers.IO,
            now = { clock.also { clock += 3_600_000 } },
            newId = { "scene-${ids++}" },
        )
        for (link in links) {
            check(library.receiveLink(link) is Intake.Kept) { "not kept: $link" }
            println("received $link")
        }
        val ridingLibrary = PlanLibrary(
            store = PlanStore(ridingOut.toPath(), FileSystem.SYSTEM),
            router = LegRouter(segments, profiles, Dispatchers.IO),
            scope = this,
            io = Dispatchers.IO,
            now = { 1_758_000_000_000L },
            newId = { "riding" },
        )
        check(ridingLibrary.receiveLink(riding) is Intake.Kept) { "not kept: $riding" }
        println("received $riding")
    }
    println("wrote $out")
}
