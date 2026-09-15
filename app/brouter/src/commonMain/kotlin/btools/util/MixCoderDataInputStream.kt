/**
 * DataInputStream for decoding fast-compact encoded number sequences
 * 
 * @author ab
 */
package btools.util

import btools.kmp.io.DataInputStream
import btools.kmp.io.IOException
import btools.kmp.io.InputStream

class MixCoderDataInputStream(`is`: InputStream) : DataInputStream(`is`) {
    private var lastValue = 0
    private var repCount = 0
    private var diffshift = 0

    private var bits = 0 // bits left in buffer
    private var b = 0 // buffer word

    @Throws(IOException::class)
    fun readMixed(): Int {
        if (repCount == 0) {
            val negative = decodeBit()
            val d = decodeVarBits() + diffshift
            repCount = decodeVarBits() + 1
            lastValue += if (negative) -d else d
            diffshift = 1
        }
        repCount--
        return lastValue
    }

    @Throws(IOException::class)
    fun decodeBit(): Boolean {
        fillBuffer()
        val value = ((b and 1) != 0)
        b = b ushr 1
        bits--
        return value
    }

    @Throws(IOException::class)
    fun decodeVarBits2(): Int {
        var range = 0
        while (!decodeBit()) {
            range = 2 * range + 1
        }
        return range + decodeBounded(range)
    }

    /**
     * decode an integer in the range 0..max (inclusive).
     * 
     * @see .encodeBounded
     */
    @Throws(IOException::class)
    fun decodeBounded(max: Int): Int {
        var value = 0
        var im = 1 // integer mask
        while ((value or im) <= max) {
            if (decodeBit()) {
                value = value or im
            }
            im = im shl 1
        }
        return value
    }


    /**
     * @see .encodeVarBits
     */
    @Throws(IOException::class)
    fun decodeVarBits(): Int {
        fillBuffer()
        val b12 = b and 0xfff
        val len: Int = vl_length[b12]
        if (len <= 12) {
            b = b ushr len
            bits -= len
            return vl_values[b12] // full value lookup
        }
        if (len <= 23) { // // only length lookup
            val len2 = len shr 1
            b = b ushr (len2 + 1)
            var mask = -0x1 ushr (32 - len2)
            mask += b and mask
            b = b ushr len2
            bits -= len
            return mask
        }
        if ((b and 0xffffff) != 0) {
            // here we just know len in [25..47]
            // ( fillBuffer guarantees only 24 bits! )
            b = b ushr 12
            val len3: Int = 1 + (vl_length[b and 0xfff] shr 1)
            b = b ushr len3
            val len2 = 11 + len3
            bits -= len2 + 1
            fillBuffer()
            var mask = -0x1 ushr (32 - len2)
            mask += b and mask
            b = b ushr len2
            bits -= len2
            return mask
        }
        return decodeVarBits2() // no chance, use the slow one
    }

    @Throws(IOException::class)
    private fun fillBuffer() {
        while (bits < 24) {
            val nextByte = read()

            if (nextByte != -1) {
                b = b or ((nextByte and 0xff) shl bits)
            }
            bits += 8
        }
    }

    companion object {
        private val vl_values = BitCoderContext.vl_values
        private val vl_length = BitCoderContext.vl_length
    }
}
