/**
 * DataOutputStream extended by varlength diff coding
 * 
 * @author ab
 */
package btools.util

import btools.kmp.io.DataOutputStream
import btools.kmp.io.IOException
import btools.kmp.io.OutputStream

class DiffCoderDataOutputStream(os: OutputStream?) : DataOutputStream(os) {
    private val lastValues = LongArray(10)

    @Throws(IOException::class)
    fun writeDiffed(v: Long, idx: Int) {
        val d = v - lastValues[idx]
        lastValues[idx] = v
        writeSigned(d)
    }

    @Throws(IOException::class)
    fun writeSigned(v: Long) {
        writeUnsigned(if (v < 0) ((-v) shl 1) or 1L else v shl 1)
    }

    @Throws(IOException::class)
    fun writeUnsigned(v: Long) {
        var v = v
        do {
            var i7 = v and 0x7fL
            v = v shr 7
            if (v != 0L) i7 = i7 or 0x80L
            writeByte((i7 and 0xffL).toByte().toInt())
        } while (v != 0L)
    }
}
