package btools.util

import btools.util.Crc32.crc
import btools.kmp.System

class ByteArrayUnifier(private val size: Int, validateImmutability: Boolean) : IByteArrayUnifier {
    private val byteArrayCache: Array<ByteArray>
    private var crcCrosscheck: IntArray? = null

    init {
        byteArrayCache = (arrayOfNulls<ByteArray>(size) as Array<ByteArray>)
        if (validateImmutability) crcCrosscheck = IntArray(size)
    }

    /**
     * Unify a byte array in order to reuse instances when possible.
     * The byte arrays are assumed to be treated as immutable,
     * allowing the reuse
     * 
     * @param ab the byte array to unify
     * @return the cached instance or the input instanced if not cached
     */
    fun unify(ab: ByteArray): ByteArray {
        return unify(ab, 0, ab.size)
    }

    override fun unify(ab: ByteArray, offset: Int, len: Int): ByteArray {
        val crc = crc(ab, offset, len)
        val idx = (crc and 0xfffffff) % size
        val abc = byteArrayCache[idx]
        if (abc != null && abc.size == len) {
            var i = 0
            while (i < len) {
                if (ab[offset + i] != abc[i]) break
                i++
            }
            if (i == len) return abc
        }
        if (crcCrosscheck != null) {
            if (byteArrayCache[idx] != null) {
                val abold = byteArrayCache[idx]
                val crcold = crc(abold, 0, abold.size)
                require(crcold == crcCrosscheck!![idx]) { "ByteArrayUnifier: immutablity validation failed!" }
            }
            crcCrosscheck!![idx] = crc
        }
        val nab = ByteArray(len)
        System.arraycopy(ab, offset, nab, 0, len)
        byteArrayCache[idx] = nab
        return nab
    }
}
