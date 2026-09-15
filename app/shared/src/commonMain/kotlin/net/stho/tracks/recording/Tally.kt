package net.stho.tracks.recording

import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.altitudeAt
import net.stho.tracks.sensors.distanceM

/** Slower than this is standing: the rule moving time is derived by, per second. */
const val MOVING_MPS = 1.0 / 3.6

/** A longer gap between fixes is not riding time, whatever the speed says: the app was dead, or had no signal. */
const val MAX_MOVING_GAP_MS = 10_000L

/** A standing phone wanders by about its accuracy; closer than this to the last counted point is not distance. */
private const val MIN_STEP_M = 3.0
private const val MAX_STEP_M = 10.0

/**
 * Distance and moving time, one fix at a time.
 *
 * A phone on a café table walks a few metres a second in no direction, and a sum of those steps is kilometres by
 * lunch. Two things keep it out:
 *
 * - **Speed.** A fix whose own speed — which CoreLocation measures by Doppler, and which does not wander the way
 *   positions do — is below [MOVING_MPS] adds no distance.
 * - **Distance from the last point that counted**, rather than from the last fix, and only once the rider is further
 *   from it than the fix's accuracy (3 to 10 m). A ride at 1 Hz moves further than that each second, so all of its
 *   distance counts; a crawl is measured in coarser steps, to the same total. This is what is left for a source that
 *   reports no speed.
 *
 * Moving time is each second whose speed is at least [MOVING_MPS]. There is no auto-pause; this is only how the time
 * is counted.
 */
class Odometer {
    var distanceM = 0.0
        private set
    var movingMillis = 0L
        private set

    private var anchor: Fix? = null
    private var last: Fix? = null

    fun add(fix: Fix) {
        val previous = last
        last = fix
        val from = anchor ?: run {
            anchor = fix
            return
        }
        val standing = fix.speedMps?.let { it < MOVING_MPS } ?: false
        val step = distanceM(from.at, fix.at)
        if (!standing && step >= (fix.accuracyM ?: MAX_STEP_M).coerceIn(MIN_STEP_M, MAX_STEP_M)) {
            distanceM += step
            anchor = fix
        }
        if (previous != null) {
            val gap = fix.epochMillis - previous.epochMillis
            val speed = fix.speedMps ?: (distanceM(previous.at, fix.at) / (gap / 1000.0))
            if (gap in 1..MAX_MOVING_GAP_MS && speed >= MOVING_MPS) movingMillis += gap
        }
    }

    /** A pause: nothing between the last fix before it and the first after it is distance or time. */
    fun pause() {
        anchor = null
        last = null
    }
}

/** How far an altitude must turn back before the climb (or the descent) before it counts. */
const val CLIMB_HYSTERESIS_M = 3.0

/**
 * Metres climbed, from a barometer's altitudes.
 *
 * Hysteresis rather than a sum of rises: a climb counts from its lowest point to its highest once the altitude has
 * come back down by [threshold] — and a rise that has not turned yet counts as far as it has got, so the figure on
 * the screen does not lag a whole climb. Noise smaller than the threshold, which on a phone's barometer is most of
 * it, never becomes a climb at all.
 */
class Climb(private val threshold: Double = CLIMB_HYSTERESIS_M) {
    private var counted = 0.0
    private var low: Double? = null
    private var high: Double? = null

    val gainM: Double get() = counted + (high?.let { it - low!! } ?: 0.0)

    fun add(altitudeM: Double) {
        val from = low ?: run {
            low = altitudeM
            return
        }
        val top = high
        if (top == null) {
            if (altitudeM < from) low = altitudeM else if (altitudeM - from >= threshold) high = altitudeM
        } else if (altitudeM > top) {
            high = altitudeM
        } else if (top - altitudeM >= threshold) {
            counted += top - from
            low = altitudeM
            high = null
        }
    }

    /** A pause: what was climbed so far stays climbed, and whatever the air does meanwhile is nobody's ascent. */
    fun pause() {
        counted = gainM
        low = null
        high = null
    }
}

/** The ride so far: [Odometer] and [Climb] over a journal's entries, as they are appended or as they are read back. */
class Tally(climbThreshold: Double = CLIMB_HYSTERESIS_M) {
    val odometer = Odometer()
    val climb = Climb(climbThreshold)

    /** Whether any pressure was read: without a barometer there is no ascent to claim. */
    var barometric = false
        private set

    fun add(entry: Entry) {
        when (entry) {
            is Entry.Located -> odometer.add(entry.fix)
            is Entry.Pressured -> {
                barometric = true
                climb.add(altitudeAt(entry.pressure.hPa))
            }
            is Entry.Paused -> {
                odometer.pause()
                climb.pause()
            }
            else -> Unit
        }
    }

    companion object {
        fun of(entries: List<Entry>) = Tally().apply { entries.forEach(::add) }
    }
}
