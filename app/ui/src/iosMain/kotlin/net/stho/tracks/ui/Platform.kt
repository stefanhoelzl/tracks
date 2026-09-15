package net.stho.tracks.ui

import kotlinx.cinterop.ExperimentalForeignApi
import okio.Path
import okio.Path.Companion.toPath
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSDateFormatterMediumStyle
import platform.Foundation.NSDateFormatterNoStyle
import platform.Foundation.NSFileManager
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURLIsExcludedFromBackupKey
import platform.Foundation.NSUserDomainMask
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Network.nw_path_get_status
import platform.Network.nw_path_monitor_cancel
import platform.Network.nw_path_monitor_create
import platform.Network.nw_path_monitor_set_queue
import platform.Network.nw_path_monitor_set_update_handler
import platform.Network.nw_path_monitor_start
import platform.Network.nw_path_status_satisfied
import platform.UIKit.UIApplicationDidEnterBackgroundNotification
import platform.UIKit.UIApplicationWillEnterForegroundNotification
import platform.darwin.dispatch_get_main_queue

/*
 * What the app needs from iOS around recording and the upload, beside the sensors and the Keychain.
 */

/**
 * Where rides are journaled: Application Support, which survives app updates and is never shown in Files, and excluded
 * from backups — a ride is on the phone for the hours until it uploads, not for a restore months later.
 */
@OptIn(ExperimentalForeignApi::class)
internal fun ridesDirectory(): Path {
    val files = NSFileManager.defaultManager
    val support = files.URLForDirectory(NSApplicationSupportDirectory, NSUserDomainMask, null, true, null)!!
    val rides = support.URLByAppendingPathComponent("rides", isDirectory = true)!!
    files.createDirectoryAtURL(rides, withIntermediateDirectories = true, attributes = null, error = null)
    rides.setResourceValue(true, forKey = NSURLIsExcludedFromBackupKey, error = null)
    return rides.path!!.toPath()
}

/** A ride with no plan is titled with its date, the way this phone writes dates. */
internal fun localDate(epochMillis: Long): String = NSDateFormatter().apply {
    dateStyle = NSDateFormatterMediumStyle
    timeStyle = NSDateFormatterNoStyle
}.stringFromDate(NSDate.dateWithTimeIntervalSince1970(epochMillis / 1000.0))

/** Calls [action] on the main queue whenever the phone has a usable network path, until the returned stop is called. */
internal fun whenOnline(action: () -> Unit): () -> Unit {
    val monitor = nw_path_monitor_create()
    nw_path_monitor_set_queue(monitor, dispatch_get_main_queue())
    nw_path_monitor_set_update_handler(monitor) { path ->
        if (nw_path_get_status(path) == nw_path_status_satisfied) action()
    }
    nw_path_monitor_start(monitor)
    return { nw_path_monitor_cancel(monitor) }
}

/** Calls [background] as the app leaves the screen and [foreground] as it comes back, until the returned stop is called. */
internal fun onAppLifecycle(background: () -> Unit, foreground: () -> Unit): () -> Unit {
    val center = NSNotificationCenter.defaultCenter
    val observers = listOf(
        center.addObserverForName(UIApplicationDidEnterBackgroundNotification, null, NSOperationQueue.mainQueue) { background() },
        center.addObserverForName(UIApplicationWillEnterForegroundNotification, null, NSOperationQueue.mainQueue) { foreground() },
    )
    return { observers.forEach(center::removeObserver) }
}

/** Where uploads go when nothing says otherwise. */
internal const val PRODUCTION_SERVER = "https://tracks.stho.net"
