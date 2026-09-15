package net.stho.tracks.ui.map

import kotlin.math.PI
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
    val speed = fix?.speedMps ?: 0.0
    return when {
        course != null && speed >= COURSE_MIN_SPEED_MPS -> course
        heading != null -> heading.degrees
        else -> previous
    }
}
