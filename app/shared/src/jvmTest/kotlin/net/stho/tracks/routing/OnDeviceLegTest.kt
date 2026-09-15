package net.stho.tracks.routing

import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind

/**
 * The on-device router over BRouter's parity snapshot: that a plan's leg comes back as the leg the web reads from
 * brouter.de, and what the phone does when it cannot route one.
 */
class OnDeviceLegTest {
    private fun env(name: String) = System.getenv(name) ?: error("$name is not set — run the tests through Gradle")

    private val segments = env("TRACKS_BROUTER_SEGMENTS")
    private val profiles = env("TRACKS_BROUTER_PROFILES")
    private val parity = File(env("TRACKS_BROUTER_PARITY"))

    private class ParityRoute(val profile: Profile, val lonlats: String, val stretch: List<Waypoint>)

    /** A parity route's request, read back into the waypoints a plan would hold. */
    private fun route(id: String): ParityRoute {
        val (_, file, lonlats) = parity.resolve("routes.tsv").readLines().map { it.split('\t') }.first { it[0] == id }
        val profile = Profile.entries.first { BRouterWire.profileFile(it) == file }
        val stretch = lonlats.split('|').map { part ->
            val fields = part.split(',')
            val name = fields.getOrNull(2)
            Waypoint(
                lat = fields[1].toDouble(),
                lon = fields[0].toDouble(),
                kind = if (name == null) WaypointKind.Routing else WaypointKind.Poi,
                name = name?.takeIf { it != "m" },
            )
        }
        return ParityRoute(profile, lonlats, stretch)
    }

    @Test
    fun routesALegAsTheWebReadsItFromBrouterDe() {
        val route = route("trekking-salzburg-hallein")
        assertEquals(route.lonlats, BRouterWire.lonlats(route.stretch), "the request the web sends")

        val leg = OnDeviceRouter.leg(segments, profiles, route.stretch, route.profile, null)
        val web = BRouterWire.leg(
            route.stretch.first(),
            route.stretch.last(),
            parity.resolve("brouter.de/trekking-salzburg-hallein.geojson").readText(),
        )
        assertEquals(web, leg)
    }

    @Test
    fun aLegWithoutTilesIsMissingDataNotAnUnroutableLeg() {
        val empty = createTempDirectory("no-segments").toFile()
        try {
            val error = assertFailsWith<NoRoutingData> {
                OnDeviceRouter.leg(empty.path, profiles, route("trekking-salzburg-hallein").stretch, Profile.Trekking, null)
            }
            assertEquals("E10_N45.rd5", error.segment)
        } finally {
            empty.delete()
        }
    }

    @Test
    fun twoPointsTheEngineCannotConnectAreAFailedLeg() {
        // The middle of the Aletsch glacier, where no way the engine knows arrives: "target island detected".
        val stretch = listOf(
            Waypoint(47.6546, 9.4797, WaypointKind.Poi, "Friedrichshafen"),
            Waypoint(46.5, 8.03, WaypointKind.Poi, null),
        )
        val leg = OnDeviceRouter.leg(segments, profiles, stretch, Profile.Trekking, null)
        assertIs<FailedLeg>(leg)
        assertTrue(leg.reason.startsWith("target island detected"), "a failed leg says why: ${leg.reason}")
    }

    @Test
    fun cancellingALegStopsTheEngineAndFreesIt(): Unit = runBlocking {
        val router = LegRouter(segments, profiles, Dispatchers.IO)
        val long = route("trekking-munich-bolzano")

        var finished = false
        val routing = launch {
            router.route(long.stretch, long.profile)
            finished = true
        }
        delay(1.seconds)
        val cancelledAt = System.nanoTime()
        routing.cancelAndJoin()
        val stoppedAfterS = (System.nanoTime() - cancelledAt) / 1e9

        assertFalse(finished, "a 300 km route should not finish within a second")
        assertTrue(stoppedAfterS < 2, "the engine stopped ${stoppedAfterS}s after being cancelled")

        val next = route("trekking-salzburg-hallein")
        assertIs<RoutedLeg>(router.route(next.stretch, next.profile), "the engine routes again after a cancel")
    }
}
