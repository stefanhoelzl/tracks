package net.stho.tracks.plan

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.has
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.fail

class PlanFragmentTest {
    private val fixture = Fixtures.read("plan.json")

    @Test
    fun formatsTheFragmentTheWebFormats() {
        for (case in fixture.cases("format")) {
            val plan = plan(case.getValue("plan"))
            assertEquals(case.string("fragment"), PlanFragment.format(plan), "$plan")
        }
    }

    @Test
    fun parsesOrRefusesAsTheWebDoes() {
        for (case in fixture.cases("parse")) {
            val hash = case.string("hash")
            if (case.has("error")) {
                val error = assertFailsWith<IllegalArgumentException>("\"$hash\"") { PlanFragment.parse(hash) }
                assertEquals(case.string("error"), error.message, "\"$hash\"")
            } else {
                assertPlanEquals(plan(case.getValue("plan")), PlanFragment.parse(hash), "\"$hash\"")
            }
        }
    }

    @Test
    fun knowsTheWebsProfiles() {
        val words = fixture.getValue("profiles").jsonArray.map { it.jsonPrimitive.content }
        assertEquals(words, Profile.entries.map { it.wire })
        assertEquals(fixture.string("defaultProfile"), DEFAULT_PROFILE.wire)
    }

    private fun plan(element: JsonElement): Plan {
        val obj = element.jsonObject
        return Plan(
            name = obj.string("name"),
            profile = Profile.of(obj.string("profile")) ?: fail("unknown profile in fixture: $obj"),
            waypoints = obj.getValue("waypoints").jsonArray.map { w ->
                val o = w.jsonObject
                Waypoint(
                    lat = o.getValue("lat").jsonPrimitive.double,
                    lon = o.getValue("lon").jsonPrimitive.double,
                    kind = if (o.string("kind") == "poi") WaypointKind.Poi else WaypointKind.Routing,
                    name = o.getValue("name").let { if (it is JsonNull) null else it.jsonPrimitive.content },
                )
            },
        )
    }

    /** Coordinates compared with `==`; a data class would tell -0.0 from 0.0, JSON cannot. */
    private fun assertPlanEquals(expected: Plan, actual: Plan, message: String) {
        assertEquals(expected.name, actual.name, "$message: name")
        assertEquals(expected.profile, actual.profile, "$message: profile")
        assertEquals(expected.waypoints.size, actual.waypoints.size, "$message: waypoints")
        expected.waypoints.zip(actual.waypoints).forEachIndexed { i, (e, a) ->
            if (e.lat != a.lat || e.lon != a.lon || e.kind != a.kind || e.name != a.name) {
                fail("$message: waypoint $i expected $e, got $a")
            }
        }
    }
}
