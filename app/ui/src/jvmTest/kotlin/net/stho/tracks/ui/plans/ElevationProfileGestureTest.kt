package net.stho.tracks.ui.plans

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.click
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import net.stho.tracks.plan.Range
import net.stho.tracks.plan.Terrain

/**
 * That the gestures on a profile reach the handlers under them.
 *
 * Written because they stopped doing so and nothing said: the module compiled, every other suite passed, and the
 * screenshots were as pretty as ever — a picture cannot press anything. A tap, a sweep and the drag of one end are the
 * whole of how a profile is read, so they are the thing worth a test here rather than the drawing.
 */
@OptIn(ExperimentalTestApi::class)
class ElevationProfileGestureTest {
    /** A kilometre of climb, ten points, measured against distance so no coordinates are needed. */
    private val terrain = Terrain(
        distances = (0..10).map { it * 100.0 },
        altitudeM = (0..10).map { 500.0 + it * 20 },
        gradients = (0..10).map { 2.0 },
        trackIndex = (0..10).toList(),
        totalM = 1000.0,
    )

    @Test
    fun aTapPutsTheBarWhereItLanded() = runComposeUiTest {
        var picked: Double? = null
        setContent {
            ElevationProfile(terrain, modifier = Modifier.size(300.dp, 140.dp), onPick = { picked = it })
        }

        onRoot().performTouchInput { click(center) }
        waitForIdle()

        val at = assertNotNull(picked, "a tap reported nothing")
        // The middle of the plot is the middle of the track, give or take the axis gutter on the left.
        assertTrue(at in 400.0..700.0, "a tap in the middle landed at $at m of 1000")
    }

    @Test
    fun aLongPressAndADragSweepsOutAStretch() = runComposeUiTest {
        var range: Range? = null
        setContent {
            ElevationProfile(terrain, modifier = Modifier.size(300.dp, 140.dp), onPick = {}, onRange = { range = it })
        }

        onRoot().performTouchInput {
            val from = Offset(center.x - 60f, center.y)
            down(from)
            // Past the long-press timeout, and then across.
            moveTo(from, delayMillis = 700)
            moveTo(Offset(center.x + 60f, center.y), delayMillis = 32)
            up()
        }
        waitForIdle()

        val swept = assertNotNull(range, "a long press and a drag reported no stretch")
        assertTrue(swept.toM > swept.fromM, "the stretch has no width: $swept")
    }

    @Test
    fun aTapAfterwardsClearsIt() = runComposeUiTest {
        var range: Range? = null
        var cleared = false
        setContent {
            ElevationProfile(
                terrain,
                modifier = Modifier.size(300.dp, 140.dp),
                onPick = {},
                onRange = {
                    range = it
                    if (it == null) cleared = true
                },
            )
        }

        onRoot().performTouchInput {
            val from = Offset(center.x - 60f, center.y)
            down(from)
            moveTo(from, delayMillis = 700)
            moveTo(Offset(center.x + 60f, center.y), delayMillis = 32)
            up()
        }
        waitForIdle()
        assertNotNull(range, "nothing to clear")

        onRoot().performTouchInput { click(center) }
        waitForIdle()

        assertTrue(cleared, "a tap left the stretch where it was")
        assertEquals(null, range)
    }

    /**
     * The profile as the riding sheet holds it: a page of a pager, inside a column you drag to open the sheet.
     *
     * Both of those want a drag, which is the whole reason the gesture is a long press — but a *tap* has to survive
     * them too, and this is where it stopped doing so.
     */
    @Test
    fun aTapSurvivesThePagerAndTheSheetAroundIt() = runComposeUiTest {
        var picked: Double? = null
        setContent {
            Column(
                Modifier.size(390.dp, 300.dp).draggable(rememberDraggableState { }, Orientation.Vertical),
            ) {
                HorizontalPager(rememberPagerState { 3 }, Modifier.fillMaxWidth().height(240.dp)) {
                    // `height` rather than a sized modifier: the profile draws into the height it is given, and a
                    // modifier taller than it leaves a band underneath that looks like the chart and is not.
                    ElevationProfile(terrain, modifier = Modifier.fillMaxWidth(), height = 200.dp, onPick = { picked = it })
                }
            }
        }

        onRoot().performTouchInput { click(center) }
        waitForIdle()

        assertNotNull(picked, "a tap inside the pager reported nothing")
    }

    /** The desktop harness drives all of this with a mouse, which is not a finger and does not have to behave alike. */
    @Test
    fun aMouseClickCountsAsATap() = runComposeUiTest {
        var picked: Double? = null
        setContent {
            ElevationProfile(terrain, modifier = Modifier.size(300.dp, 140.dp), onPick = { picked = it })
        }

        onRoot().performMouseInput { click(center) }
        waitForIdle()

        assertNotNull(picked, "a mouse click reported nothing")
    }

    /**
     * A ride's profile is a new `Terrain` every fix — it grows as you go — and a sweep has to survive that.
     *
     * Keyed on the terrain, the gesture's own coroutine was cancelled and restarted underneath the finger, so a drag
     * died a second or two in. That is not something a compile or a screenshot can see.
     */
    @Test
    fun aSweepSurvivesTheTrackGrowingUnderIt() = runComposeUiTest {
        var range: Range? = null
        var grown by mutableStateOf(0)
        setContent {
            // A new Terrain object each time, as the recorder publishes one: same shape, one more point.
            val growing = remember(grown) {
                Terrain(
                    distances = (0..10 + grown).map { it * 100.0 },
                    altitudeM = (0..10 + grown).map { 500.0 + it * 20 },
                    gradients = (0..10 + grown).map { 2.0 },
                    trackIndex = (0..10 + grown).toList(),
                    totalM = (10 + grown) * 100.0,
                )
            }
            ElevationProfile(
                growing,
                modifier = Modifier.size(300.dp, 140.dp),
                onPick = {},
                onRange = { range = it },
            )
        }

        onRoot().performTouchInput {
            down(Offset(center.x - 60f, center.y))
            moveTo(Offset(center.x - 60f, center.y), delayMillis = 700)
            moveTo(Offset(center.x - 20f, center.y), delayMillis = 32)
        }
        waitForIdle()
        val early = assertNotNull(range, "the sweep reported nothing before the track grew")

        // The track grows under the finger, twice, as it would while riding.
        grown = 1
        waitForIdle()
        grown = 2
        waitForIdle()

        onRoot().performTouchInput { moveTo(Offset(center.x + 60f, center.y), delayMillis = 32) }
        waitForIdle()
        onRoot().performTouchInput { up() }

        val late = assertNotNull(range, "the sweep stopped reporting once the track grew under it")
        assertTrue(
            late.toM > early.toM,
            "the sweep stopped following the finger: it ended at ${late.toM} having reached ${early.toM}",
        )
    }
}
