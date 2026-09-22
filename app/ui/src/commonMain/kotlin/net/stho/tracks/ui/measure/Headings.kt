package net.stho.tracks.ui.measure

import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import net.stho.tracks.sensors.Heading
import net.stho.tracks.ui.sensors.Sensors

/**
 * These sensors with the compass replaced by a synthetic one speaking [hz] times a second, [jitterDeg] either side
 * of where the source compass last pointed.
 *
 * A replayed ride delivers exactly one heading a second, so it cannot show what a busy compass costs. This puts that
 * rate back, reproducibly, and sweeps it rather than guessing it; [withHeadingsFrom] is the real compass instead. A
 * hand-held phone gave 10-30 headings a second at a 1° filter and 4-6 at the product's 5°.
 *
 * The source's own headings are followed rather than its fixes: sensor flows are cold, and collecting the fixes a
 * second time would start a second replay.
 */
fun Sensors.withSyntheticHeadings(hz: Double, jitterDeg: Double, seed: Int = 205): Sensors {
    val source = this
    return object : Sensors {
        override val fixes = source.fixes
        override val pressures = source.pressures
        override val headings: Flow<Heading> = channelFlow {
            var base: Double? = null
            launch { source.headings.collect { base = it.degrees } }
            val random = Random(seed)
            val period = (1000.0 / hz).milliseconds
            while (true) {
                delay(period)
                val b = base ?: continue
                val degrees = ((b + (random.nextDouble() * 2 - 1) * jitterDeg) % 360 + 360) % 360
                send(Heading(degrees, Clock.System.now().toEpochMilliseconds()))
            }
            @Suppress("UNREACHABLE_CODE")
            awaitClose()
        }
    }
}

/**
 * These sensors with the compass taken from [compass] — the replayed ride's fixes with the phone's real headings, so
 * the compass is priced where the rider is above walking pace and the map does not turn with it.
 */
fun Sensors.withHeadingsFrom(compass: Sensors): Sensors {
    val source = this
    return object : Sensors {
        override val fixes = source.fixes
        override val pressures = source.pressures
        override val headings: Flow<Heading> = compass.headings
    }
}

/** These sensors, counting every heading into [HeadingCalls] on its way through. */
fun Sensors.countingHeadings(): Sensors {
    val source = this
    return object : Sensors {
        override val fixes = source.fixes
        override val pressures = source.pressures
        override val headings: Flow<Heading> = source.headings.onEach { HeadingCalls.count++ }
    }
}
