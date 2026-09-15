package net.stho.tracks.ui.sensors

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOn
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import platform.CoreLocation.CLActivityTypeFitness
import platform.CoreLocation.CLHeading
import platform.CoreLocation.CLLocation
import platform.CoreLocation.CLLocationManager
import platform.CoreLocation.CLLocationManagerDelegateProtocol
import platform.CoreLocation.kCLLocationAccuracyBest
import platform.Foundation.timeIntervalSince1970
import platform.darwin.NSObject

/**
 * The phone's own [Sensors]: CoreLocation's position and compass, while the app is in the foreground.
 *
 * Background location belongs to recording (M15), and so does the barometer: [pressures] is empty until then.
 * Each flow owns a [Listener], started when collected and stopped when the collector goes, on the main thread, whose
 * run loop CoreLocation delivers to.
 */
class LocationSensors : Sensors {
    override val fixes: Flow<Fix> = callbackFlow {
        val listener = Listener(onLocation = { trySend(it.fix()) })
        listener.manager.apply {
            desiredAccuracy = kCLLocationAccuracyBest
            activityType = CLActivityTypeFitness
            requestWhenInUseAuthorization()
            startUpdatingLocation()
        }
        awaitClose { listener.stop() }
    }.flowOn(Dispatchers.Main)

    override val headings: Flow<Heading> = callbackFlow {
        val listener = Listener(onHeading = { heading ->
            // True north needs a location fix; until there is one, iOS reports -1 and magnetic north is what there is.
            val degrees = heading.trueHeading.takeIf { it >= 0 } ?: heading.magneticHeading
            trySend(Heading(degrees, (heading.timestamp.timeIntervalSince1970 * 1000).toLong()))
        })
        listener.manager.apply {
            headingFilter = 1.0
            startUpdatingHeading()
        }
        awaitClose { listener.stop() }
    }.flowOn(Dispatchers.Main)

    override val pressures: Flow<Pressure> = emptyFlow()
}

/**
 * A CLLocationManager and its delegate, in one object that something holds.
 *
 * CLLocationManager keeps its delegate weakly. A delegate that only the manager points to is, to Kotlin/Native,
 * garbage: it is collected, and every update goes to nobody, silently. Whoever holds a Listener holds both.
 */
private class Listener(
    private val onLocation: (CLLocation) -> Unit = {},
    private val onHeading: (CLHeading) -> Unit = {},
) : NSObject(), CLLocationManagerDelegateProtocol {
    val manager = CLLocationManager().also { it.delegate = this }

    override fun locationManager(manager: CLLocationManager, didUpdateLocations: List<*>) {
        (didUpdateLocations.lastOrNull() as? CLLocation)?.let(onLocation)
    }

    override fun locationManager(manager: CLLocationManager, didUpdateHeading: CLHeading) {
        onHeading(didUpdateHeading)
    }

    fun stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        manager.delegate = null
    }
}

/** CoreLocation marks a value it does not have with a negative accuracy or a negative value. */
@OptIn(ExperimentalForeignApi::class)
private fun CLLocation.fix(): Fix {
    val at = coordinate.useContents { Coordinate(latitude, longitude) }
    return Fix(
        at = at,
        altitudeM = altitude.takeIf { verticalAccuracy >= 0 },
        courseDeg = course.takeIf { it >= 0 && courseAccuracy >= 0 },
        speedMps = speed.takeIf { it >= 0 },
        accuracyM = horizontalAccuracy.takeIf { it >= 0 },
        epochMillis = (timestamp.timeIntervalSince1970 * 1000).toLong(),
    )
}
