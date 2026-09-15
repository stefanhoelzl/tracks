/**
 * DataOutputStream for fast-compact encoding of number sequences
 * 
 * @author ab
 */
package btools.util

import btools.kmp.io.DataOutputStream
import btools.kmp.io.IOException
import btools.kmp.io.OutputStream

class MixCoderDataOutputStream(os: OutputStream?) : DataOutputStream(os) {
    private var lastValue = 0
    private var lastLastValue = 0
    private var repCount = 0
    private var diffshift = 0

    private var bm = 1 // byte mask (write mode)
    private var b = 0

    @Throws(IOException::class)
    fun writeMixed(v: Int) {
        if (v != lastValue && repCount > 0) {
            var d = lastValue - lastLastValue
            lastLastValue = lastValue

            encodeBit(d < 0)
            if (d < 0) {
                d = -d
            }
            encodeVarBits(d - diffshift)
            encodeVarBits(repCount - 1)

            if (d < 100) diffs[d]++
            if (repCount < 100) counts[repCount]++

            diffshift = 1
            repCount = 0
        }
        lastValue = v
        repCount++
    }

    @Throws(IOException::class)
    override fun flush() {
        val v = lastValue
        writeMixed(v + 1)
        lastValue = v
        repCount = 0
        if (bm > 1) {
            writeByte(b.toByte().toInt()) // flush bit-coding
        }
    }

    @Throws(IOException::class)
    fun encodeBit(value: Boolean) {
        if (bm == 0x100) {
            writeByte(b.toByte().toInt())
            bm = 1
            b = 0
        }
        if (value) {
            b = b or bm
        }
        bm = bm shl 1
    }

    @Throws(IOException::class)
    fun encodeVarBits(value: Int) {
        var value = value
        var range = 0
        while (value > range) {
            encodeBit(false)
            value -= range + 1
            range = 2 * range + 1
        }
        encodeBit(true)
        encodeBounded(range, value)
    }

    @Throws(IOException::class)
    fun encodeBounded(max: Int, value: Int) {
        var max = max
        var im = 1 // integer mask
        while (im <= max) {
            if (bm == 0x100) {
                writeByte(b.toByte().toInt())
                bm = 1
                b = 0
            }
            if ((value and im) != 0) {
                b = b or bm
                max -= im
            }
            bm = bm shl 1
            im = im shl 1
        }
    }

    companion object {
        var diffs: IntArray = IntArray(100)
        var counts: IntArray = IntArray(100)

        fun stats() {
            for (i in 1..99) println("diff[" + i + "] = " + diffs[i])
            for (i in 1..99) println("counts[" + i + "] = " + counts[i])
        }
    }
}
