package net.stho.tracks.ui.sensors

import kotlin.time.Instant
import net.stho.tracks.codec.Coordinate

/** A track point as a GPX file has it: a position, and an elevation and a time when the file carries them. */
data class TrackPoint(val at: Coordinate, val elevationM: Double?, val epochMillis: Long?)

/**
 * The track points of a GPX file, every track and segment in document order.
 *
 * Only as much GPX as a replay needs: routes, waypoints and extensions are ignored. The web's parser is the one
 * that has to be complete; this reads rides into a harness.
 */
object Gpx {
    private const val NS = """(?:[\w.-]+:)?"""
    private val point = Regex("""<${NS}trkpt\b([^>]*?)(?:/>|>([\s\S]*?)</${NS}trkpt\s*>)""")
    private val lat = Regex("""\blat\s*=\s*["']([^"']+)["']""")
    private val lon = Regex("""\blon\s*=\s*["']([^"']+)["']""")
    private val ele = Regex("""<${NS}ele\s*>\s*([^<\s]+)\s*<""")
    private val time = Regex("""<${NS}time\s*>\s*([^<\s]+)\s*<""")

    fun trackPoints(xml: String): List<TrackPoint> = point.findAll(xml).mapNotNull { match ->
        val attributes = match.groupValues[1]
        val body = match.groupValues[2]
        val latitude = lat.find(attributes)?.groupValues?.get(1)?.toDoubleOrNull() ?: return@mapNotNull null
        val longitude = lon.find(attributes)?.groupValues?.get(1)?.toDoubleOrNull() ?: return@mapNotNull null
        TrackPoint(
            at = Coordinate(latitude, longitude),
            elevationM = ele.find(body)?.groupValues?.get(1)?.toDoubleOrNull(),
            epochMillis = time.find(body)?.groupValues?.get(1)?.let { text ->
                runCatching { Instant.parse(text).toEpochMilliseconds() }.getOrNull()
            },
        )
    }.toList()
}
