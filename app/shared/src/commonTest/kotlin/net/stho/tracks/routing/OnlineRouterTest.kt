package net.stho.tracks.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertSame
import kotlinx.coroutines.test.runTest
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.places.Http
import net.stho.tracks.places.HttpResponse
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.leg
import net.stho.tracks.plan.waypoint
import net.stho.tracks.plan.waypoints
import net.stho.tracks.string

class OnlineRouterTest {
    private val fixture = Fixtures.read("brouter.json")
    private val recorded = fixture.cases("files").first()
    private val from = recorded.getValue("from").waypoint()
    private val to = recorded.getValue("to").waypoint()

    private class FakeHttp(var answer: () -> HttpResponse) : Http {
        val asked = mutableListOf<String>()

        override suspend fun get(url: String): HttpResponse {
            asked += url
            return answer()
        }
    }

    @Test
    fun asksBrouterDeWithTheWebsParametersAndReadsItsTrack() = runTest {
        val http = FakeHttp { HttpResponse(200, Fixtures.repoText(recorded.string("file"))) }

        val leg = BRouterDe(http).route(listOf(from, to), Profile.Trekking)

        assertEquals(recorded.getValue("leg").leg(), leg)
        val lonlats = BRouterWire.lonlats(listOf(from, to))
        assertEquals(
            "https://brouter.de/brouter?lonlats=${FormEncoded.of(lonlats)}&profile=trekking&alternativeidx=0&format=geojson",
            http.asked.single(),
        )
    }

    @Test
    fun theWebsLonlatsGoOutUnchanged() {
        for (case in fixture.cases("lonlats")) {
            val stretch = case.getValue("stretch").waypoints()
            val params = net.stho.tracks.plan.FormUrlEncoded.parse(BRouterDe.params(stretch, Profile.Hiking))
            assertEquals(
                listOf("lonlats" to case.string("lonlats"), "profile" to "hiking-mountain", "alternativeidx" to "0", "format" to "geojson"),
                params,
            )
        }
    }

    @Test
    fun a400IsALegThatCannotBeRoutedAndAnythingElseIsTheServers() = runTest {
        val http = FakeHttp { HttpResponse(400, "  target island detected for section 0\n") }
        assertEquals(FailedLeg(from, to, "target island detected for section 0"), BRouterDe(http).route(listOf(from, to), Profile.Trekking))

        http.answer = { HttpResponse(403, "Please, retry later!") }
        assertEquals("Please, retry later!", assertFailsWith<RouterUnreachable> { BRouterDe(http).route(listOf(from, to), Profile.Trekking) }.message)

        http.answer = { error("no route to host") }
        assertFailsWith<RouterUnreachable> { BRouterDe(http).route(listOf(from, to), Profile.Trekking) }
    }

    private class Recording(private val answer: suspend () -> Leg) : LegRouting {
        var asked = 0

        override suspend fun route(stretch: List<Waypoint>, profile: Profile): Leg {
            asked++
            return answer()
        }
    }

    private fun routed(name: String) = RoutedLeg(from, to.copy(name = name), emptyList(), emptyList(), 1.0, 0.0, 0.0, 1.0)

    @Test
    fun onlineAsksBrouterDeAndOfflineTheDevice() = runTest {
        val web = routed("web")
        val device = routed("device")
        val online = Recording { web }
        val onDevice = Recording { device }
        var connected = true
        val router = OnlineFirstRouter(online, onDevice) { connected }

        assertSame(web, router.route(listOf(from, to), Profile.Trekking))
        connected = false
        assertSame(device, router.route(listOf(from, to), Profile.Trekking))
        assertEquals(1, online.asked)
        assertEquals(1, onDevice.asked)
    }

    @Test
    fun aServerThatCannotBeReachedFallsBackToTheDeviceButAFailedLegDoesNot() = runTest {
        val device = routed("device")
        val onDevice = Recording { device }

        val unreachable = OnlineFirstRouter(Recording { throw RouterUnreachable("Could not reach brouter.de") }, onDevice) { true }
        assertSame(device, unreachable.route(listOf(from, to), Profile.Trekking))

        val island = FailedLeg(from, to, "target island detected")
        val refused = OnlineFirstRouter(Recording { island }, onDevice) { true }
        assertIs<FailedLeg>(refused.route(listOf(from, to), Profile.Trekking))
        assertEquals(1, onDevice.asked, "the web's answer that two points cannot be connected is the answer")

        val noTiles = OnlineFirstRouter(Recording { throw RouterUnreachable("down") }, Recording { throw NoRoutingData("E20_N40.rd5") }) { true }
        assertFailsWith<NoRoutingData> { noTiles.route(listOf(from, to), Profile.Trekking) }
    }
}

/** What `URLSearchParams` makes of one value, for reading the expected URL. */
private object FormEncoded {
    fun of(value: String): String = net.stho.tracks.plan.FormUrlEncoded.serialize(listOf("x" to value)).removePrefix("x=")
}
