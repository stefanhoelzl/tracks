package net.stho.tracks.store

import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanFragment
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.plan.leg
import net.stho.tracks.string
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlanStoreTest {
    private val fileSystem = FakeFileSystem()
    private val directory = "/app-support/plans".toPath()
    private val store = PlanStore(directory, fileSystem)

    /** BRouter's recorded answer for Salzburg to Hallein, as a leg: a real line, with real elevation. */
    private val routed: RoutedLeg = Fixtures.read("brouter.json").cases("files")
        .first { it.string("file").endsWith("trekking-salzburg-hallein.geojson") }
        .getValue("leg").leg() as RoutedLeg

    /** Three stops and a shaping point, at the fragment's precision, with a routed leg, a failed one, and one not yet routed. */
    private fun plan(name: String = "Salzach"): Plan = PlanFragment.parse(
        PlanFragment.format(
            Plan(
                name = name,
                profile = Profile.Gravel,
                waypoints = listOf(
                    Waypoint(routed.from.lat, routed.from.lon, WaypointKind.Poi, "Salzburg"),
                    Waypoint(47.7, 13.08, WaypointKind.Routing, null),
                    Waypoint(routed.to.lat, routed.to.lon, WaypointKind.Poi, null),
                    Waypoint(47.6, 13.1, WaypointKind.Poi, "Golling"),
                    Waypoint(47.5, 13.2, WaypointKind.Poi, "Werfen"),
                ),
            ),
        ),
    )

    private fun stored(id: String, savedAt: Long, plan: Plan = plan()): StoredPlan {
        val stops = plan.waypoints.filter { it.kind == WaypointKind.Poi }
        return StoredPlan(
            id = id,
            savedAtMillis = savedAt,
            plan = plan,
            legs = listOf(
                routed.copy(from = plan.waypoints[0], to = plan.waypoints[2]),
                FailedLeg(stops[1], stops[2], "target island detected"),
                null,
            ),
        )
    }

    @Test
    fun keepsThePlanAndItsLegsExactly() {
        val plan = stored("a", 1_000)
        store.save(plan)
        assertEquals(plan, store.load("a"))
    }

    @Test
    fun listsNewestFirst() {
        store.save(stored("older", 1_000))
        store.save(stored("newest", 3_000))
        store.save(stored("middle", 2_000))
        assertEquals(listOf("newest", "middle", "older"), store.list().map { it.id })
    }

    @Test
    fun savingOverwritesAndDeletingRemoves() {
        store.save(stored("a", 1_000))
        store.save(stored("a", 2_000, plan("Renamed")))
        assertEquals(listOf("Renamed"), store.list().map { it.plan.name })

        store.delete("a")
        assertEquals(emptyList(), store.list())
        store.delete("a")
    }

    @Test
    fun aLegIsDroppedWhenItsWaypointsNoLongerMatch() {
        store.save(stored("a", 1_000))
        val file = directory / "a.json"
        val text = fileSystem.read(file) { readUtf8() }
        // The same plan file with the profile changed underneath its legs: every key now names another profile.
        fileSystem.write(file) { writeUtf8(text.replace("profile=gravel", "profile=mtb")) }

        val loaded = store.load("a")!!
        assertEquals(Profile.Mtb, loaded.plan.profile)
        assertEquals(listOf(null, null, null), loaded.legs)
    }

    @Test
    fun leavesFilesItCannotReadWhereTheyAre() {
        store.save(stored("good", 1_000))
        fileSystem.write(directory / "garbage.json") { writeUtf8("{ not json") }
        fileSystem.write(directory / "future.json") {
            writeUtf8("""{"schemaVersion":2,"id":"future","savedAtMillis":5,"fragment":"","legs":[]}""")
        }

        assertEquals(listOf("good"), store.list().map { it.id })
        assertTrue(fileSystem.exists(directory / "garbage.json"))
        assertTrue(fileSystem.exists(directory / "future.json"))
    }

    @Test
    fun refusesAPlanItsLinkWouldNotCarry() {
        val precise = plan().let { it.copy(waypoints = it.waypoints.map { w -> w.copy(lat = w.lat + 0.0000012) }) }
        assertFailsWith<IllegalArgumentException> { store.save(stored("a", 1_000).copy(plan = precise)) }
        assertFailsWith<IllegalArgumentException> { store.save(stored("a", 1_000).copy(legs = emptyList())) }
        assertFailsWith<IllegalArgumentException> { store.save(stored("../escape", 1_000)) }
        assertNull(store.load("missing"))
    }

    @Test
    fun makesIdsAFileCanBeNamedFor() {
        val id = PlanStore.newId(Random(1))
        assertEquals(16, id.length)
        store.save(stored(id, 1))
        assertEquals(id, store.list().single().id)
    }
}
