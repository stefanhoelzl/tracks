/**
 * DataInputStream extended by varlength diff coding
 * 
 * @author ab
 */
package btools.util

import btools.kmp.io.DataInputStream
import btools.kmp.io.IOException
import btools.kmp.io.InputStream

class DiffCoderDataInputStream(`is`: InputStream) : DataInputStream(`is`) {
    private val lastValues = LongArray(10)

    @Throws(IOException::class)
    fun readDiffed(idx: Int): Long {
        val d = readSigned()
        val v = lastValues[idx] + d
        lastValues[idx] = v
        return v
    }

    @Throws(IOException::class)
    fun readSigned(): Long {
        val v = readUnsigned()
        return if ((v and 1L) == 0L) v shr 1 else -(v shr 1)
    }

    @Throws(IOException::class)
    fun readUnsigned(): Long {
        var v: Long = 0
        var shift = 0
        while (true) {
            val i7 = (readByte().toInt() and 0xff).toLong()
            v = v or ((i7 and 0x7fL) shl shift)
            if ((i7 and 0x80L) == 0L) break
            shift += 7
        }
        return v
    }
}
