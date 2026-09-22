package net.stho.tracks.ui.map

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading

/**
 * Where to aim the camera so that [at] shows [downDp] above and [rightDp] left of the map's centre — the centre of what
 * an inset leaves uncovered — on a map turned to [bearingDeg].
 *
 * The map library's camera takes no padding while it animates to a position, so the offset is made in the target: the
 * aim is [at] moved that far down and right on the screen, which on a turned map is along the bearing. At a rider's
 * zoom the offsets are a few hundred metres, where a flat earth is exact enough.
 */
internal fun insetTarget(at: Coordinate, zoom: Double, bearingDeg: Double, downDp: Double, rightDp: Double): Coordinate {
    if (downDp == 0.0 && rightDp == 0.0) return at
    val rad = PI / 180
    // MapLibre's world is 512 logical pixels wide at zoom 0.
    val metresPerDp = 40_075_016.686 * cos(at.lat * rad) / (512 * 2.0.pow(zoom))
    val down = (bearingDeg + 180) * rad
    val right = (bearingDeg + 90) * rad
    val north = (cos(down) * downDp + cos(right) * rightDp) * metresPerDp
    val east = (sin(down) * downDp + sin(right) * rightDp) * metresPerDp
    return Coordinate(lat = at.lat + north / 111_320.0, lon = at.lon + east / (111_320.0 * cos(at.lat * rad)))
}

/** Below 4 km/h GPS course is noise, and the compass takes over. */
const val COURSE_MIN_SPEED_MPS = 4.0 / 3.6

enum class Orientation { HeadingUp, NorthUp }

/**
 * Which way up the map is drawn, degrees clockwise from true north.
 *
 * North-up is north-up. Heading-up follows the GPS course while moving, because on a handlebar mount the compass
 * reads the mount's magnetism and every bump; below [COURSE_MIN_SPEED_MPS] it follows the compass, because there
 * the course is noise; and with neither it stays where it was rather than snapping north.
 */
fun mapBearing(orientation: Orientation, fix: Fix?, heading: Heading?, previous: Double): Double {
    if (orientation == Orientation.NorthUp) return 0.0
    val course = fix?.courseDeg
    return when {
        course != null && onCourse(fix) -> course
        heading != null -> heading.degrees
        else -> previous
    }
}

/**
 * Whether [mapBearing] turns the map by the compass at [fix]: heading-up, and slower than [COURSE_MIN_SPEED_MPS] or
 * with no course. Anywhere else the heading is discarded, so a camera that asks this first need not listen to the
 * compass at all — which matters, because a phone moving on a handlebar reports a heading many times a second, and
 * each one the camera listens to cancels its glide and starts it again for nothing.
 */
fun compassTurnsMap(orientation: Orientation, fix: Fix?): Boolean = orientation == Orientation.HeadingUp && !onCourse(fix)

/** Moving fast enough that the GPS course, not the compass, says which way the map is turned. */
private fun onCourse(fix: Fix?): Boolean = fix?.courseDeg != null && (fix.speedMps ?: 0.0) >= COURSE_MIN_SPEED_MPS

/** How far the way you are going must move from the way the map is turned before the riding map turns after it. */
const val TURN_THRESHOLD_DEG = 10.0

/**
 * The bearing the riding map turns to: [target], once it is more than [TURN_THRESHOLD_DEG] from [current], and
 * [current] until then.
 *
 * The GPS course wobbles by a few degrees from one fix to the next. Followed exactly, the map turned a little every
 * second, and a river running along the road — upright on a heading-up map — kept crossing the vertical, where MapLibre
 * turns a line label round to keep it readable: its name swapped direction once a second. Held until the way you are
 * going has really changed, the map turns in steps on a bend and not at all on a straight.
 */
fun steadyBearing(target: Double, current: Double): Double {
    val apart = abs(((target - current) % 360 + 540) % 360 - 180)
    return if (apart > TURN_THRESHOLD_DEG) target else current
}
