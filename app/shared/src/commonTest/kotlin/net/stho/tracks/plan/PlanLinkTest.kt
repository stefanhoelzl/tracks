package net.stho.tracks.plan

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class PlanLinkTest {
    private val plan = Plan(
        name = "Ötztal loop",
        profile = Profile.Gravel,
        waypoints = listOf(
            Waypoint(47.2654, 11.3931, WaypointKind.Poi, "Start"),
            Waypoint(47.2678, 11.3952, WaypointKind.Routing, null),
            Waypoint(47.2668, 11.3975, WaypointKind.Poi, "Gasthof, Vent"),
        ),
    )

    @Test
    fun writesTheLinkTheWebOpens() {
        assertEquals("https://tracks.stho.net/?mode=planning#${PlanFragment.format(plan)}", PlanLink.format(plan))
    }

    @Test
    fun readsItBack() {
        assertEquals(plan, PlanLink.find(PlanLink.format(plan)))
    }

    @Test
    fun findsTheLinkInAMessage() {
        val message = "Tomorrow? <${PlanLink.format(plan)}>\nsee you at 8"
        assertEquals(plan, PlanLink.find(message))
    }

    @Test
    fun readsALinkCopiedFromTheAddressBarWithAFilterBesideTheMode() {
        val fragment = PlanFragment.format(plan)
        assertEquals(plan, PlanLink.find("https://tracks.stho.net/?tags=sport%3Abike&mode=planning#$fragment"))
        assertEquals(plan, PlanLink.find("http://www.tracks.stho.net/?mode=planning#$fragment"))
    }

    @Test
    fun ignoresWhatTheWebWouldNotOpenAsAPlan() {
        val fragment = PlanFragment.format(plan)
        assertNull(PlanLink.find("https://tracks.stho.net/?mode=analytics#$fragment"))
        assertNull(PlanLink.find("https://tracks.stho.net/#$fragment"))
        assertNull(PlanLink.find("https://example.com/?mode=planning#$fragment"))
        assertNull(PlanLink.find("https://tracks.stho.net/?mode=planning"))
        assertNull(PlanLink.find("https://tracks.stho.net/?mode=planning#name=Only+a+name"))
        assertNull(PlanLink.find("no link here"))
    }

    @Test
    fun refusesABrokenPlanRatherThanKeepingHalfOfIt() {
        assertFailsWith<IllegalArgumentException> {
            PlanLink.find("https://tracks.stho.net/?mode=planning#at=_p~iF~ps%7CU&kinds=pp")
        }
    }
}
