package net.stho.tracks.ui.map

import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading

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
