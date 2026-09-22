package net.stho.tracks.ui.sensors

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.ui.measure.MeasureOverrides
import platform.CoreLocation.CLActivityTypeFitness
import platform.CoreLocation.CLBackgroundActivitySession
import platform.CoreLocation.CLHeading
import platform.CoreLocation.CLLocation
import platform.CoreLocation.CLLocationManager
import platform.CoreLocation.CLLocationManagerDelegateProtocol
import platform.CoreLocation.kCLLocationAccuracyBest
import platform.CoreMotion.CMAltimeter
import platform.Foundation.NSDate
import platform.Foundation.NSOperationQueue
import platform.Foundation.timeIntervalSince1970
import platform.darwin.NSObject

/**
 * The phone's own [Sensors]: CoreLocation's position and compass, and the barometer.
 *
 * Location runs in the foreground, and — while [recording] — in the background too, with the phone locked: iOS shows
 * the blue location pill for as long as it does, and a background activity session keeps the app alive to receive the
 * fixes. The permission is still only *When In Use*; a ride started in the app is a use.
 *
 * Each flow owns what it reads, started when collected and stopped when the collector goes, on the main thread, whose
 * run loop CoreLocation delivers to.
 */
class LocationSensors : Sensors {
    private val listeners = mutableSetOf<Listener>()

    /** Whether location updates continue with the app in the background. Set on the main thread. */
    var recording: Boolean = false
        set(value) {
            field = value
            listeners.forEach { it.background(value) }
        }

    override val fixes: Flow<Fix> = callbackFlow {
        val listener = Listener(onLocation = { trySend(it.fix()) })
        listener.manager.apply {
            desiredAccuracy = kCLLocationAccuracyBest
            activityType = CLActivityTypeFitness
            // A ride standing at a junction is still a ride: iOS would otherwise decide the updates can stop.
            pausesLocationUpdatesAutomatically = false
            requestWhenInUseAuthorization()
            startUpdatingLocation()
        }
        listeners += listener
        listener.background(recording)
        awaitClose {
            listeners -= listener
            listener.stop()
        }
    }.flowOn(Dispatchers.Main)

    override val headings: Flow<Heading> = callbackFlow {
        val listener = Listener(onHeading = { heading ->
            // True north needs a location fix; until there is one, iOS reports -1 and magnetic north is what there is.
            val degrees = heading.trueHeading.takeIf { it >= 0 } ?: heading.magneticHeading
            trySend(Heading(degrees, (heading.timestamp.timeIntervalSince1970 * 1000).toLong()))
        })
        listener.manager.apply {
            // Five degrees, not one. At one, a phone moved by hand reported ~30 headings a second (on the SE2), and
            // each is work for the map; the facing cone is 60° wide and the compass turns the map only below walking
            // pace, so a finer heading than this shows nothing a rider could see. app/docs/BATTERY.md.
            headingFilter = MeasureOverrides.headingFilter ?: 5.0
            startUpdatingHeading()
        }
        awaitClose { listener.stop() }
    }.flowOn(Dispatchers.Main)

    /**
     * The barometer, as CMAltimeter reads it: kilopascals, as hPa, stamped when they arrive.
     *
     * A phone without one emits nothing, and a ride recorded on it claims no ascent.
     */
    override val pressures: Flow<Pressure> = callbackFlow {
        val altimeter = CMAltimeter()
        if (CMAltimeter.isRelativeAltitudeAvailable()) {
            altimeter.startRelativeAltitudeUpdatesToQueue(NSOperationQueue.mainQueue) { data, _ ->
                data?.let { trySend(Pressure(it.pressure.doubleValue * 10.0, (NSDate().timeIntervalSince1970 * 1000).toLong())) }
            }
        }
        awaitClose { altimeter.stopRelativeAltitudeUpdates() }
    }.flowOn(Dispatchers.Main)
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

    /** Held while updates run in the background: what tells iOS a backgrounded app is still in use. */
    private var session: CLBackgroundActivitySession? = null

    override fun locationManager(manager: CLLocationManager, didUpdateLocations: List<*>) {
        (didUpdateLocations.lastOrNull() as? CLLocation)?.let(onLocation)
    }

    override fun locationManager(manager: CLLocationManager, didUpdateHeading: CLHeading) {
        onHeading(didUpdateHeading)
    }

    fun background(on: Boolean) {
        manager.allowsBackgroundLocationUpdates = on
        manager.showsBackgroundLocationIndicator = on
        if (on) {
            if (session == null) session = CLBackgroundActivitySession.backgroundActivitySession()
        } else {
            session?.invalidate()
            session = null
        }
    }

    fun stop() {
        background(false)
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
