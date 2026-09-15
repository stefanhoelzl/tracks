package net.stho.tracks.plan

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.has
import net.stho.tracks.int
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals

/** The editor's rules, pinned to `plan-ops.ts` and `plan-track.ts` by `plan-edit.json`. */
class PlanEditTest {
    private val fixture = Fixtures.read("plan-edit.json")
    private val scenarios = fixture.cases("scenarios")

    @Test
    fun readsAPlanAsTheWebDoes() {
        for (scenario in scenarios) {
            val name = scenario.string("name")
            val plan = scenario.getValue("plan").plan()

            assertEquals(scenario.getValue("poiIndices").ints(), poiIndices(plan.waypoints), name)
            assertEquals(scenario.string("derivedName"), derivedName(plan), name)
            assertEquals(scenario.int("legCount"), legCount(plan), name)
            assertEquals(scenario.getValue("kindIsAChoice").jsonPrimitive.boolean, kindIsAChoice(plan), name)
            for (case in scenario.cases("legLabels")) {
                val leg = case.int("leg")
                assertEquals(case.getValue("label").stringOrNull(), legLabel(plan, leg), "$name: leg $leg")
            }
        }
    }

    @Test
    fun placesATapWhereTheWebDoes() {
        for (scenario in scenarios) {
            val plan = scenario.getValue("plan").plan()
            val legs = scenario.getValue("legs").legs()

            for (tap in scenario.cases("taps")) {
                val at = tap.getValue("at").latLon()
                val message = "${scenario.string("name")}: tap at $at"

                val nearest = nearestLeg(plan, legs, at)
                assertEquals(tap.getValue("nearestLeg").intOrNull(), nearest, message)
                for (case in tap.cases("insertions")) {
                    val leg = case.int("leg")
                    assertEquals(case.int("index"), insertionAt(plan, legs, leg, at), "$message, into leg $leg")
                }
                assertEquals(tap.int("start"), placementAt(plan, legs, Placement.Start, nearest, at), "$message, start")
                assertEquals(tap.int("end"), placementAt(plan, legs, Placement.End, nearest, at), "$message, end")
                assertEquals(tap.int("nearest"), placementAt(plan, legs, Placement.Nearest, nearest, at), "$message, nearest")
                assertEquals(tap.int("unplaced"), placementAt(plan, legs, Placement.Nearest, null, at), "$message, no leg")
            }
        }
    }

    @Test
    fun editsAsTheWebDoes() {
        val added = Waypoint(47.1, 11.2, WaypointKind.Poi, "New")
        val movedTo = Coordinate(47.123456, 11.654321)

        for (scenario in scenarios.filter { it.has("added") }) {
            val name = scenario.string("name")
            val plan = scenario.getValue("plan").plan()

            for (case in scenario.cases("added")) {
                val index = case.int("index")
                assertEquals(case.getValue("plan").plan(), addWaypoint(plan, added, index), "$name: add at $index")
            }
            for (case in scenario.cases("removed")) {
                val index = case.int("index")
                assertEquals(case.getValue("plan").plan(), removeWaypoint(plan, index), "$name: remove $index")
            }
            for (case in scenario.cases("kinds")) {
                val index = case.int("index")
                val kind = if (case.string("kind") == "poi") WaypointKind.Poi else WaypointKind.Routing
                assertEquals(case.getValue("plan").plan(), setKind(plan, index, kind), "$name: $index to $kind")
            }
            for (case in scenario.cases("moved")) {
                val index = case.int("index")
                assertEquals(case.getValue("plan").plan(), moveWaypoint(plan, index, movedTo), "$name: move $index")
            }
            for (case in scenario.cases("stops")) {
                val from = case.int("from")
                val to = case.int("to")
                assertEquals(case.getValue("plan").plan(), moveStop(plan, from, to), "$name: stop $from to $to")
            }
        }
    }

    @Test
    fun readsTheLegsAsTheWebDoes() {
        for (scenario in scenarios) {
            val name = scenario.string("name")
            val plan = scenario.getValue("plan").plan()
            val legs = scenario.getValue("legs").legs()

            assertEquals(
                scenario.getValue("geometries").jsonArray.map { it.lonLats() },
                legGeometries(plan.waypoints, legs),
                "$name: geometries",
            )
            assertEquals(scenario.getValue("totals").totals(), planTotals(legs), "$name: totals")

            val track = scenario.getValue("track").jsonObject
            assertEquals(
                PlanTrack(
                    coordinates = track.getValue("coordinates").lonLats(),
                    altitudeM = track.getValue("altitudeM").jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.double },
                ),
                planTrack(legs),
                "$name: track",
            )

            assertEquals(scenario.getValue("cumulative").jsonArray.map { it.totals() }, cumulative(legs), "$name: cumulative")

            for (case in scenario.cases("readings")) {
                val base = case.int("base")
                val expected = case.getValue("readings").jsonArray.map { reading ->
                    if (reading is JsonNull) {
                        null
                    } else {
                        reading.jsonObject.let {
                            StopReading(
                                distanceM = it.getValue("distanceM").jsonPrimitive.double,
                                ascentM = it.getValue("ascentM").jsonPrimitive.double,
                                incomplete = it.getValue("incomplete").jsonPrimitive.boolean,
                            )
                        }
                    }
                }
                assertEquals(expected, readingsFrom(legs, base), "$name: readings from $base")
            }

            val bounds = scenario.getValue("bounds")
            val expectedBounds = if (bounds is JsonNull) null else bounds.doubles().let { Bounds(it[0], it[1], it[2], it[3]) }
            assertEquals(expectedBounds, planBounds(plan.waypoints, legs), "$name: bounds")
        }
    }

    @Test
    fun measuresAlongAPathAsTheWebDoes() {
        for (case in fixture.cases("nearestOnPath")) {
            val path = case.getValue("path").lonLats()
            val lon = case.getValue("lon").jsonPrimitive.double
            val lat = case.getValue("lat").jsonPrimitive.double
            val message = "$lon,$lat on $path"

            val hit = nearestOnPath(path, lon, lat)
            val expected = case.getValue("hit").jsonObject
            assertClose(expected.getValue("position").jsonPrimitive.double, hit.position, "$message: position")
            val distance = expected.getValue("distanceM")
            if (distance is JsonNull) {
                assertEquals(Double.POSITIVE_INFINITY, hit.distanceM, "$message: distance")
            } else {
                assertClose(distance.jsonPrimitive.double, hit.distanceM, "$message: distance")
            }
        }
    }
}
