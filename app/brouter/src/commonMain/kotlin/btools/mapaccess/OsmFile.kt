/**
 * cache for a single square
 * 
 * @author ab
 */
package btools.mapaccess

import btools.codec.*
import btools.codec.MicroCache.Companion.emptyCache
import btools.util.ByteDataReader
import btools.util.Crc32
import btools.kmp.io.IOException
import btools.kmp.io.RandomAccessFile
import kotlin.jvm.JvmField

class OsmFile(rafile: PhysicalFile?, @JvmField var lonDegree: Int, var latDegree: Int, dataBuffers: DataBuffers) {
    private var `is`: RandomAccessFile? = null
    private var fileOffset: Long = 0

    private lateinit var posIdx: IntArray
    private var microCaches: Array<MicroCache?>? = null

    @JvmField
    var filename: String? = null

    private var divisor = 0
    private var cellsize = 0
    private var indexsize = 0
    @JvmField
    var elevationType: Byte = 3

    init {
        val lonMod5 = lonDegree % 5
        val latMod5 = latDegree % 5
        val tileIndex = lonMod5 * 5 + latMod5

        if (rafile != null) {
            divisor = rafile.divisor
            elevationType = rafile.elevationType

            cellsize = 1000000 / divisor
            val ncaches = divisor * divisor
            indexsize = ncaches * 4

            val iobuffer = dataBuffers.iobuffer
            filename = rafile.fileName

            val index = rafile.fileIndex
            fileOffset = if (tileIndex > 0) index[tileIndex - 1] else 200L
            if (fileOffset != index[tileIndex]) { // else: empty


            `is` = rafile.ra
            posIdx = IntArray(ncaches)
            microCaches = arrayOfNulls<MicroCache>(ncaches)
            `is`!!.seek(fileOffset)
            `is`!!.readFully(iobuffer, 0, indexsize)

            if (rafile.fileHeaderCrcs != null) {
                val headerCrc = Crc32.crc(iobuffer!!, 0, indexsize)
                if (rafile.fileHeaderCrcs!![tileIndex] != headerCrc) {
                    throw IOException("sub index checksum error")
                }
            }

            val dis = ByteDataReader(iobuffer)
            for (i in 0..<ncaches) {
                posIdx[i] = dis.readInt()
            }
            }
        }
    }

    fun hasData(): Boolean {
        return microCaches != null
    }

    fun getMicroCache(ilon: Int, ilat: Int): MicroCache? {
        val lonIdx = ilon / cellsize
        val latIdx = ilat / cellsize
        val subIdx = (latIdx - divisor * latDegree) * divisor + (lonIdx - divisor * lonDegree)
        return microCaches!![subIdx]
    }

    @Throws(Exception::class)
    fun createMicroCache(
        ilon: Int,
        ilat: Int,
        dataBuffers: DataBuffers,
        wayValidator: TagValueValidator?,
        waypointMatcher: WaypointMatcher?,
        hollowNodes: OsmNodesMap?
    ): MicroCache? {
        val lonIdx = ilon / cellsize
        val latIdx = ilat / cellsize
        val segment = createMicroCache(lonIdx, latIdx, dataBuffers, wayValidator, waypointMatcher, true, hollowNodes)
        val subIdx = (latIdx - divisor * latDegree) * divisor + (lonIdx - divisor * lonDegree)
        microCaches!![subIdx] = segment
        return segment
    }

    private fun getPosIdx(idx: Int): Int {
        return if (idx == -1) indexsize else posIdx[idx]
    }

    @Throws(IOException::class)
    fun getDataInputForSubIdx(subIdx: Int, iobuffer: ByteArray): Int {
        val startPos = getPosIdx(subIdx - 1)
        val endPos = getPosIdx(subIdx)
        val size = endPos - startPos
        if (size > 0) {
            `is`!!.seek(fileOffset + startPos)
            if (size <= iobuffer.size) {
                `is`!!.readFully(iobuffer, 0, size)
            }
        }
        return size
    }

    @Throws(IOException::class)
    fun createMicroCache(
        lonIdx: Int, latIdx: Int, dataBuffers: DataBuffers, wayValidator: TagValueValidator?,
        waypointMatcher: WaypointMatcher?, reallyDecode: Boolean, hollowNodes: OsmNodesMap?
    ): MicroCache? {
        val subIdx = (latIdx - divisor * latDegree) * divisor + (lonIdx - divisor * lonDegree)

        var ab = dataBuffers.iobuffer
        var asize = getDataInputForSubIdx(subIdx, ab!!)

        if (asize == 0) {
            return emptyCache()
        }
        if (asize > ab.size) {
            ab = ByteArray(asize)
            asize = getDataInputForSubIdx(subIdx, ab)
        }

        val bc = StatCoderContext(ab)

        try {
            if (!reallyDecode) {
                return null
            }
            if (hollowNodes == null) {
                return MicroCache2(bc, dataBuffers, lonIdx, latIdx, divisor, wayValidator, waypointMatcher)
            }
            DirectWeaver(bc, dataBuffers, lonIdx, latIdx, divisor, wayValidator!!, waypointMatcher, hollowNodes)
            return MicroCache.emptyNonVirgin
        } finally {
            // crc check only if the buffer has not been fully read
            val readBytes = (bc.readingBitPosition + 7) shr 3
            if (readBytes != asize - 4) {
                val crcData = Crc32.crc(ab, 0, asize - 4)
                val crcFooter = ByteDataReader(ab, asize - 4).readInt()
                if (crcData == crcFooter) {
                    throw IOException("old, unsupported data-format")
                } else if ((crcData xor 2) != crcFooter) {
                    throw IOException("checkum error")
                }
            }
        }
    }

    // set this OsmFile to ghost-state:
    fun setGhostState(): Long {
        var sum: Long = 0
        val nc = if (microCaches == null) 0 else microCaches!!.size
        for (i in 0..<nc) {
            val mc = microCaches!![i]
            if (mc == null) continue
            if (mc.virgin) {
                mc.ghost = true
                sum += mc.dataSize.toLong()
            } else {
                microCaches!![i] = null
            }
        }
        return sum
    }

    fun collectAll(): Long {
        var deleted: Long = 0
        val nc = if (microCaches == null) 0 else microCaches!!.size
        for (i in 0..<nc) {
            val mc = microCaches!![i]
            if (mc == null) continue
            if (!mc.ghost) {
                deleted += mc.collect(0).toLong()
            }
        }
        return deleted
    }

    fun cleanGhosts(): Long {
        val deleted: Long = 0
        val nc = if (microCaches == null) 0 else microCaches!!.size
        for (i in 0..<nc) {
            val mc = microCaches!![i]
            if (mc == null) continue
            if (mc.ghost) {
                microCaches!![i] = null
            }
        }
        return deleted
    }

    fun clean(all: Boolean) {
        val nc = if (microCaches == null) 0 else microCaches!!.size
        for (i in 0..<nc) {
            val mc = microCaches!![i]
            if (mc == null) continue
            if (all || !mc.virgin) {
                microCaches!![i] = null
            }
        }
    }
}
