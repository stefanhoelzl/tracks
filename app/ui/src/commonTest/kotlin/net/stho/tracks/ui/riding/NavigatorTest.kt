package net.stho.tracks.ui.riding

import kotlin.math.PI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.WaypointKind
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.sensors.Sensors

@OptIn(ExperimentalCoroutinesApi::class)
class NavigatorTest {
    private val metre = 1.0 / (6_371_000.0 * PI / 180.0)

    private fun at(northM: Double) = Coordinate(47.0 + northM * metre, 11.0)

    private class FakeSensors : Sensors {
        override val fixes = MutableSharedFlow<Fix>(replay = 1)
        override val headings = emptyFlow<Heading>()
        override val pressures = emptyFlow<Pressure>()
    }

    private fun stop(northM: Double, name: String) = Waypoint(at(northM).lat, at(northM).lon, WaypointKind.Poi, name)

    private fun leg(fromM: Double, toM: Double): RoutedLeg {
        val points = (0..10).map { at(fromM + (toM - fromM) * it / 10) }
        return RoutedLeg(stop(fromM, ""), stop(toM, ""), points, points.map { 700.0 }, toM - fromM, 0.0, 0.0, 0.0)
    }

    private fun plan(id: String, legs: List<Leg?>) = StoredPlan(
        id = id,
        savedAtMillis = 0,
        plan = Plan(name = id, waypoints = listOf(stop(0.0, "A"), stop(1000.0, "B"), stop(2000.0, "C"))),
        legs = legs,
    )

    private suspend fun TestScope.fix(sensors: FakeSensors, northM: Double) {
        sensors.fixes.emit(Fix(at(northM), null, null, 5.0, 5.0, 0))
        runCurrent()
    }

    @Test
    fun itFollowsThePlanItIsToldToAndItsFixes() = runTest {
        val sensors = FakeSensors()
        val plans = MutableStateFlow(listOf(plan("one", listOf(leg(0.0, 1000.0), leg(1000.0, 2000.0)))))
        val navigator = Navigator(sensors, plans, backgroundScope)
        runCurrent()
        assertNull(navigator.state.value)

        navigator.follow("one")
        runCurrent()
        assertNull(assertNotNull(navigator.state.value).progress)

        fix(sensors, 400.0)
        val progress = assertNotNull(navigator.state.value?.progress)
        assertEquals(400.0, progress.alongM, 2.0)
        assertEquals(1, progress.nextStop)

        navigator.follow(null)
        runCurrent()
        assertNull(navigator.state.value)
    }

    @Test
    fun aLegThatFinishesRoutingKeepsWhereYouAre() = runTest {
        val sensors = FakeSensors()
        val plans = MutableStateFlow(listOf(plan("one", listOf(leg(0.0, 1000.0), null))))
        val navigator = Navigator(sensors, plans, backgroundScope)
        navigator.follow("one")
        runCurrent()
        fix(sensors, 600.0)
        assertTrue(navigator.state.value!!.progress!!.toFinish.incomplete)

        plans.value = listOf(plan("one", listOf(leg(0.0, 1000.0), leg(1000.0, 2000.0))))
        runCurrent()
        val progress = assertNotNull(navigator.state.value?.progress)
        assertEquals(600.0, progress.alongM, 2.0)
        assertEquals(1400.0, progress.toFinish.distanceM, 2.0)
        assertTrue(!progress.toFinish.incomplete)
    }

    @Test
    fun aPlanThatIsDeletedIsNoLongerFollowed() = runTest {
        val sensors = FakeSensors()
        val plans = MutableStateFlow(listOf(plan("one", listOf(leg(0.0, 1000.0), leg(1000.0, 2000.0)))))
        val navigator = Navigator(sensors, plans, backgroundScope)
        navigator.follow("one")
        runCurrent()
        fix(sensors, 100.0)
        assertNotNull(navigator.state.value)

        plans.value = emptyList()
        runCurrent()
        assertNull(navigator.state.value)
    }
}
