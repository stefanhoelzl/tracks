/**
 * Access to the storageconfig.txt config file
 * 
 * @author ab
 */
package btools.mapaccess

import btools.kmp.io.BufferedReader
import btools.kmp.io.File
import btools.kmp.io.FileReader
import kotlin.jvm.JvmStatic

object StorageConfigHelper {
    @JvmStatic
    fun getSecondarySegmentDir(segmentDir: File?): File? {
        return getStorageLocation(segmentDir, "secondary_segment_dir=")
    }

    @JvmStatic
    fun getAdditionalMaptoolDir(segmentDir: File?): File? {
        return getStorageLocation(segmentDir, "additional_maptool_dir=")
    }

    private fun getStorageLocation(segmentDir: File?, tag: String): File? {
        var res: File? = null
        var br: BufferedReader? = null
        val configFile = File(segmentDir, "storageconfig.txt")
        try {
            br = BufferedReader(FileReader(configFile))
            while (true) {
                var line = br.readLine()
                if (line == null) break
                line = line.trim { it <= ' ' }
                if (line.startsWith("#")) {
                    continue
                }
                if (line.startsWith(tag)) {
                    val path = line.substring(tag.length).trim { it <= ' ' }
                    res = if (path.startsWith("/")) File(path) else File(segmentDir, path)
                    if (!res.exists()) res = null
                    break
                }
            }
        } catch (e: Exception) { /* ignore */
        } finally {
            if (br != null) {
                try {
                    br.close()
                } catch (ee: Exception) { /* ignore */
                }
            }
        }
        return res
    }
}
