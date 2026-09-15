/**
 * static helper class for handling datafiles
 * 
 * @author ab
 */
package btools.router

import btools.mapaccess.StorageConfigHelper
import btools.kmp.io.File

object RoutingHelper {
    fun getAdditionalMaptoolDir(segmentDir: File?): File? {
        return StorageConfigHelper.getAdditionalMaptoolDir(segmentDir)
    }

    fun getSecondarySegmentDir(segmentDir: File?): File? {
        return StorageConfigHelper.getSecondarySegmentDir(segmentDir)
    }


    fun hasDirectoryAnyDatafiles(segmentDir: File): Boolean {
        if (hasAnyDatafiles(segmentDir)) {
            return true
        }
        // check secondary, too
        val secondary = StorageConfigHelper.getSecondarySegmentDir(segmentDir)
        if (secondary != null) {
            return hasAnyDatafiles(secondary)
        }
        return false
    }

    private fun hasAnyDatafiles(dir: File): Boolean {
        val fileNames = dir.list()
        for (fileName in fileNames!!) {
            if (fileName.endsWith(".rd5")) return true
        }
        return false
    }
}
