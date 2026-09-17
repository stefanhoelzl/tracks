package net.stho.tracks.recording

import kotlin.math.roundToLong
import kotlin.time.Instant
import net.stho.tracks.codec.Polyline
import net.stho.tracks.importing.IMPORT_PRECISION
import net.stho.tracks.importing.ImportFrame
import net.stho.tracks.sensors.altitudeAt

/** What a ride recorded here is imported as: the recorder, not the device, so a second recorder would be the same source. */
const val RECORDED_SOURCE = "tracks"

/** A fix less accurate than this is not kept. */
const val MAX_ACCURACY_M = 30.0

/** The sports the Save sheet offers, as `sport:` values. */
val SPORTS = listOf("bike", "hike", "run")

/**
 * A plan's profile, as a sport: every bike profile is `bike`, hiking is `hike`, and a ride with no plan is a bike ride.
 * No profile is a run: `run` is only ever chosen on the Save sheet.
 */
fun sportFor(profile: String?): String = if (profile == "hiking") "hike" else "bike"

/**
 * A saved ride as the import frame, exactly as the web sends an activity: one per request, to the unchanged route.
 *
 * - **Altitudes** are the barometer's, anchored to GPS: each fix takes the last pressure read before it, as an altitude,
 *   plus the median of how far GPS altitude sat from it over the whole ride. The median, because GPS altitude is off
 *   by tens of metres now and then and the barometer drifts slowly with the weather; one offset for the ride spreads
 *   the drift instead of kinking the profile. Without a barometer they are GPS's own. Rounded to 1 m, the one
 *   thing shrunk for the wire.
 * - **Ascent** is [Climb] over the barometer, and null without one: the app is the service reporting it, and a service
 *   with no barometer has no ascent to report.
 * - **Moving time** is [Odometer]'s, and **elapsed** the wall clock from the first fix to the last, pauses included.
 */
object RideFrame {
    fun of(ride: Ride): ImportFrame {
        val saved = ride.saved ?: throw IllegalArgumentException("ride ${ride.id} is not saved")
        val located = ride.fixes
        require(located.isNotEmpty()) { "ride ${ride.id} has no fixes" }

        val fixes = located.map { it.fix }
        val pressures = ride.entries.filterIsInstance<Entry.Pressured>().map { it.pressure }
        val tally = Tally.of(ride.entries)

        // Whole seconds, so every offset is an integer from a start that is one.
        val start = fixes.first().epochMillis / 1000 * 1000
        val end = fixes.last().epochMillis

        val altitudes: List<Double?>? = if (pressures.isEmpty()) {
            fixes.map { it.altitudeM }.takeIf { values -> values.any { it != null } }
        } else {
            var p = 0
            val barometric = fixes.map { fix ->
                while (p + 1 < pressures.size && pressures[p + 1].epochMillis <= fix.epochMillis) p++
                altitudeAt(pressures[p].hPa)
            }
            val offsets = fixes.indices.mapNotNull { i -> fixes[i].altitudeM?.let { it - barometric[i] } }
            val offset = offsets.sorted().let { if (it.isEmpty()) 0.0 else it[it.size / 2] }
            barometric.map { it + offset }
        }

        return ImportFrame(
            source = RECORDED_SOURCE,
            externalId = ride.id,
            title = saved.title,
            startedAt = Instant.fromEpochMilliseconds(start).toString(),
            distanceM = tally.odometer.distanceM.roundToLong().toDouble(),
            durationS = tally.odometer.movingMillis / 1000,
            elapsedS = ((end - start) / 1000.0).roundToLong(),
            elevationGainM = if (tally.barometric) tally.climb.gainM.roundToLong().toDouble() else null,
            tags = listOf("sport:${saved.sport}"),
            geometry = Polyline.encode(fixes.map { it.at }, IMPORT_PRECISION),
            altitudes = altitudes?.map { it?.roundToLong()?.toDouble() },
            times = fixes.map { ((it.epochMillis - start) / 1000.0).roundToLong() },
        )
    }
}
