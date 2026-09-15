/**
 * cache for a single square
 * 
 * @author ab
 */
package btools.mapaccess

import btools.codec.DataBuffers
import btools.codec.MicroCache
import btools.util.ByteDataReader
import btools.util.Crc32
import btools.kmp.io.File
import btools.kmp.io.IOException
import btools.kmp.io.RandomAccessFile
import btools.kmp.System
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

class PhysicalFile(f: File, dataBuffers: DataBuffers, lookupVersion: Int, lookupMinorVersion: Int) {
    @JvmField
    var ra: RandomAccessFile? = null
    @JvmField
    var fileIndex: LongArray = LongArray(25)
    @JvmField
    var fileHeaderCrcs: IntArray? = null

    var creationTime: Long = 0

    @JvmField
    var fileName: String?

    @JvmField
    var divisor: Int = 80
    @JvmField
    var elevationType: Byte = 3

    init {
        fileName = f.getName()
        val iobuffer = dataBuffers.iobuffer
        ra = RandomAccessFile(f, "r")
        ra!!.readFully(iobuffer, 0, 200)
        val fileIndexCrc = Crc32.crc(iobuffer!!, 0, 200)
        var dis = ByteDataReader(iobuffer)
        for (i in 0..24) {
            val lv = dis.readLong()
            val readVersion = (lv shr 48).toShort()
            if (i == 0 && lookupVersion != -1 && readVersion.toInt() != lookupVersion) {
                throw IOException(
                    ("lookup version mismatch (old rd5?) lookups.dat="
                            + lookupVersion + " " + f.getName() + "=" + readVersion)
                )
            }
            fileIndex[i] = lv and 0xffffffffffffL
        }

        // read some extra info from the end of the file, if present
        val len = ra!!.length()

        val pos = fileIndex[24]
        var extraLen = 8 + 26 * 4

        if (len != pos) { // else: old format o.k.


        if ((len - pos) > extraLen) {
            extraLen++
        }

        if (len < pos + extraLen) { // > is o.k. for future extensions!
            throw IOException("file of size " + len + " too short, should be " + (pos + extraLen))
        }

        ra!!.seek(pos)
        ra!!.readFully(iobuffer, 0, extraLen)
        dis = ByteDataReader(iobuffer)
        creationTime = dis.readLong()

        val crcData = dis.readInt()
        if (crcData == fileIndexCrc) {
            divisor = 80 // old format
        } else if ((crcData xor 2) == fileIndexCrc) {
            divisor = 32 // new format
        } else {
            throw IOException("top index checksum error")
        }
        fileHeaderCrcs = IntArray(25)
        for (i in 0..24) {
            fileHeaderCrcs!![i] = dis.readInt()
        }
        try {
            elevationType = dis.readByte()
        } catch (e: Exception) {
        }
        }
    }

    fun close() {
        if (ra != null) {
            try {
                ra!!.close()
            } catch (ee: Exception) {
            }
        }
    }

    companion object {
        @JvmStatic
        fun main(args: Array<String>) {
            MicroCache.debug = true

            try {
                checkFileIntegrity(File(args[0]))
            } catch (e: IOException) {
                System.err.println("************************************")
                e.printStackTrace()
                System.err.println("************************************")
            }
        }

        fun checkVersionIntegrity(f: File): Int {
            var version = -1
            var raf: RandomAccessFile? = null
            try {
                val iobuffer = ByteArray(200)
                raf = RandomAccessFile(f, "r")
                raf.readFully(iobuffer, 0, 200)
                val dis = ByteDataReader(iobuffer)
                val lv = dis.readLong()
                version = (lv shr 48).toInt()
            } catch (e: IOException) {
            } finally {
                try {
                    if (raf != null) raf.close()
                } catch (e: IOException) {
                    throw RuntimeException(e)
                }
            }
            return version
        }

        /**
         * Checks the integrity of the file using the build-in checksums
         * 
         * @return the error message if file corrupt, else null
         */
        @Throws(IOException::class)
        fun checkFileIntegrity(f: File): String? {
            var pf: PhysicalFile? = null
            try {
                val dataBuffers = DataBuffers()
                pf = PhysicalFile(f, dataBuffers, -1, -1)
                val div = pf.divisor
                for (lonDegree in 0..4) { // doesn't really matter..
                    for (latDegree in 0..4) { // ..where on earth we are
                        val osmf = OsmFile(pf, lonDegree, latDegree, dataBuffers)
                        if (osmf.hasData()) for (lonIdx in 0..<div) for (latIdx in 0..<div) osmf.createMicroCache(
                            lonDegree * div + lonIdx,
                            latDegree * div + latIdx,
                            dataBuffers,
                            null,
                            null,
                            MicroCache.debug,
                            null
                        )
                    }
                }
            } finally {
                if (pf != null) try {
                    pf.ra!!.close()
                } catch (ee: Exception) {
                }
            }
            return null
        }
    }
}
