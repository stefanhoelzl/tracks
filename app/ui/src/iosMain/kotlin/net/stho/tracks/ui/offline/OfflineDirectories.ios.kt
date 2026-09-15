package net.stho.tracks.ui.offline

import kotlinx.cinterop.ExperimentalForeignApi
import okio.Path
import okio.Path.Companion.toPath
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSDocumentDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSNumber
import platform.Foundation.NSSearchPathDirectory
import platform.Foundation.NSURL
import platform.Foundation.NSURLIsExcludedFromBackupKey
import platform.Foundation.NSURLVolumeAvailableCapacityForImportantUsageKey
import platform.Foundation.NSUserDomainMask

/*
 * Where offline data lives on the phone. Never Caches: iOS empties it when it wants the space, and a map gone blank
 * halfway up a pass is exactly what this data is for. Always out of backups: all of it downloads again.
 */

@OptIn(ExperimentalForeignApi::class)
private fun appDirectory(kind: NSSearchPathDirectory, name: String): NSURL {
    val files = NSFileManager.defaultManager
    val directory = files.URLForDirectory(kind, NSUserDomainMask, null, true, null)!!.URLByAppendingPathComponent(name, isDirectory = true)!!
    files.createDirectoryAtURL(directory, withIntermediateDirectories = true, attributes = null, error = null)
    directory.setResourceValue(true, forKey = NSURLIsExcludedFromBackupKey, error = null)
    return directory
}

/** MapLibre's database, offline packs and all: Application Support. */
internal fun mapsCacheFile(): String = appDirectory(NSApplicationSupportDirectory, "maps").path!! + "/maplibre.db"

/** Where the engine reads segment tiles: Documents/segments, as M10's shell always has — half a gigabyte a place. */
internal fun segmentsDirectory(): Path = appDirectory(NSDocumentDirectory, "segments").path!!.toPath()

/** What offline data keeps about itself: where the area around you is centred. */
internal fun offlineDirectory(): Path = appDirectory(NSApplicationSupportDirectory, "offline").path!!.toPath()

/** What iOS would free for something the person asked for — which a map for their plan is — in bytes. */
@OptIn(ExperimentalForeignApi::class)
internal fun freeBytes(): Long? {
    val documents = NSFileManager.defaultManager.URLForDirectory(NSDocumentDirectory, NSUserDomainMask, null, false, null) ?: return null
    val values = documents.resourceValuesForKeys(listOf(NSURLVolumeAvailableCapacityForImportantUsageKey), null) ?: return null
    return (values[NSURLVolumeAvailableCapacityForImportantUsageKey] as? NSNumber)?.longLongValue
}
