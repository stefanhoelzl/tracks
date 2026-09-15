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
 * Each flow owns its own CLLocationManager, started when collected and stopped when the collector goes, on the main
 * thread, whose run loop CoreLocation delivers to.
 */
@OptIn(ExperimentalForeignApi::class)
class LocationSensors : Sensors {
    override val fixes: Flow<Fix> = callbackFlow {
        val delegate = object : NSObject(), CLLocationManagerDelegateProtocol {
            override fun locationManager(manager: CLLocationManager, didUpdateLocations: List<*>) {
                (didUpdateLocations.lastOrNull() as? CLLocation)?.let { trySend(it.fix()) }
            }
        }
        val manager = CLLocationManager().apply {
            this.delegate = delegate
            desiredAccuracy = kCLLocationAccuracyBest
            activityType = CLActivityTypeFitness
            requestWhenInUseAuthorization()
            startUpdatingLocation()
        }
        awaitClose {
            manager.stopUpdatingLocation()
            manager.delegate = null
        }
    }.flowOn(Dispatchers.Main)

    override val headings: Flow<Heading> = callbackFlow {
        val delegate = object : NSObject(), CLLocationManagerDelegateProtocol {
            override fun locationManager(manager: CLLocationManager, didUpdateHeading: CLHeading) {
                // True north needs a location fix; until there is one, iOS reports -1 and magnetic north is what there is.
                val degrees = didUpdateHeading.trueHeading.takeIf { it >= 0 } ?: didUpdateHeading.magneticHeading
                trySend(Heading(degrees, (didUpdateHeading.timestamp.timeIntervalSince1970 * 1000).toLong()))
            }
        }
        val manager = CLLocationManager().apply {
            this.delegate = delegate
            headingFilter = 1.0
            startUpdatingHeading()
        }
        awaitClose {
            manager.stopUpdatingHeading()
            manager.delegate = null
        }
    }.flowOn(Dispatchers.Main)

    override val pressures: Flow<Pressure> = emptyFlow()
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
