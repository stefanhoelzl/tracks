package net.stho.tracks.routing

import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.has
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.descentOf
import net.stho.tracks.plan.doubles
import net.stho.tracks.plan.leg
import net.stho.tracks.plan.stretches
import net.stho.tracks.plan.waypoint
import net.stho.tracks.plan.waypoints
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** BRouter's request and answer, pinned to `packages/routing/src/brouter/index.ts` by `brouter.json`. */
class BRouterWireTest {
    private val fixture = Fixtures.read("brouter.json")

    @Test
    fun namesTheProfilesAsBrouterDeDoes() {
        val files = fixture.getValue("profileFiles").jsonObject
        assertEquals(files.keys, Profile.entries.map { it.wire }.toSet())
        for (profile in Profile.entries) assertEquals(files.string(profile.wire), BRouterWire.profileFile(profile))
    }

    @Test
    fun cutsLegsAsTheWebDoes() {
        for (case in fixture.cases("stretches")) {
            val waypoints = case.getValue("waypoints").waypoints()
            val expected = case.getValue("stretches").jsonArray.map { it.waypoints() }
            assertEquals(expected, stretches(waypoints), "$waypoints")
        }
    }

    @Test
    fun derivesDescentAsTheWebDoes() {
        for (case in fixture.cases("descents")) {
            val ascent = case.getValue("ascentM").jsonPrimitive.double
            val altitude = case.getValue("altitudeM").doubles()
            assertEquals(case.getValue("descentM").jsonPrimitive.double, descentOf(ascent, altitude), "$ascent over $altitude")
        }
    }

    @Test
    fun asksForALegAsTheWebDoes() {
        for (case in fixture.cases("lonlats")) {
            val stretch = case.getValue("stretch").waypoints()
            assertEquals(case.string("lonlats"), BRouterWire.lonlats(stretch), "$stretch")
        }
    }

    @Test
    fun readsRecordedAnswersAsTheWebDoes() {
        for (case in fixture.cases("files")) {
            val file = case.string("file")
            val leg = BRouterWire.leg(case.getValue("from").waypoint(), case.getValue("to").waypoint(), Fixtures.repoText(file))
            assertEquals(case.getValue("leg").leg(), leg, file)
        }
    }

    @Test
    fun readsOrRefusesAnswersAsTheWebDoes() {
        val from = fixture.cases("files").first().getValue("from").waypoint()
        val to = fixture.cases("files").first().getValue("to").waypoint()

        for (case in fixture.cases("bodies")) {
            val body = case.getValue("body").toString()
            if (case.has("error")) {
                assertFailsWith<RouterError>(body) { BRouterWire.leg(from, to, body) }
            } else {
                assertEquals(case.getValue("leg").leg(), BRouterWire.leg(from, to, body), body)
            }
        }
    }
}
