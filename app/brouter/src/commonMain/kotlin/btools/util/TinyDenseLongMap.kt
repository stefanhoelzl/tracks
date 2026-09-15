package btools.util

/**
 * TinyDenseLongMap implements the DenseLongMap interface
 * but actually is made for a medium count of non-dense keys
 * 
 * 
 * It's used as a replacement for DenseLongMap where we
 * have limited memory and far less keys than maykey
 * 
 * @author ab
 */
class TinyDenseLongMap : DenseLongMap() {
    private val al: Array<LongArray?>
    private val pa: IntArray
    private var size = 0
    private val _maxKeepExponent = 14 // the maximum exponent to keep the invalid arrays

    private val vla: Array<ByteArray?> // value list array

    init {
        // pointer array
        pa = IntArray(MAXLISTS)

        // allocate key lists
        al = arrayOfNulls<LongArray>(MAXLISTS)
        al[0] = LongArray(1) // make the first array (the transient buffer)

        // same for the values
        vla = arrayOfNulls<ByteArray>(MAXLISTS)
        vla[0] = ByteArray(1)
    }


    private fun fillReturnValue(rv: ByteArray, idx: Int, p: Int) {
        rv[0] = vla[idx]!![p]
        if (rv.size == 2) {
            vla[idx]!![p] = rv[1]
        }
    }

    public override fun put(id: Long, value: Int) {
        val rv = ByteArray(2)
        rv[1] = value.toByte()
        if (contains(id, rv)) {
            return
        }

        vla[0]!![0] = value.toByte()
        _add(id)
    }


    /**
     * Get the byte for the given id
     * 
     * @param id the key to query
     * @return the object
     * @throws IllegalArgumentException if id is unknown
     */
    public override fun getInt(id: Long): Int {
        val rv = ByteArray(1)
        if (contains(id, rv)) {
            return rv[0].toInt()
        }
        return -1
    }


    private fun _add(id: Long): Boolean {
        require(size != Int.MAX_VALUE) { "cannot grow beyond size Int.MAX_VALUE" }

        // put the new entry in the first array
        al[0]!![0] = id

        // determine the first empty array
        var bp = size++ // treat size as bitpattern
        var idx = 1
        var n = 1

        pa[0] = 1
        pa[1] = 1

        while ((bp and 1) == 1) {
            bp = bp shr 1
            pa[idx++] = n
            n = n shl 1
        }

        // create it if not existant
        if (al[idx] == null) {
            al[idx] = LongArray(n)
            vla[idx] = ByteArray(n)
        }

        // now merge the contents of arrays 0...idx-1 into idx
        while (n > 0) {
            var maxId: Long = 0
            var maxIdx = -1

            for (i in 0..<idx) {
                val p = pa[i]
                if (p > 0) {
                    val currentId = al[i]!![p - 1]
                    if (maxIdx < 0 || currentId > maxId) {
                        maxIdx = i
                        maxId = currentId
                    }
                }
            }

            // current maximum found, copy to target array
            require(!(n < al[idx]!!.size && maxId == al[idx]!![n])) { "duplicate key found in late check: " + maxId }
            --n
            al[idx]!![n] = maxId
            vla[idx]!![n] = vla[maxIdx]!![pa[maxIdx] - 1]

            --pa[maxIdx]
        }

        // de-allocate empty arrays of a certain size (fix at 64kByte)
        while (idx-- > _maxKeepExponent) {
            al[idx] = null
            vla[idx] = null
        }

        return false
    }


    private fun contains(id: Long, rv: ByteArray?): Boolean {
        // determine the first empty array
        var bp = size // treat size as bitpattern
        var idx = 1

        while (bp != 0) {
            if ((bp and 1) == 1) {
                // array at idx is valid, check
                if (contains(idx, id, rv)) {
                    return true
                }
            }
            idx++
            bp = bp shr 1
        }
        return false
    }


    // does sorted array "a" contain "id" ?
    private fun contains(idx: Int, id: Long, rv: ByteArray?): Boolean {
        val a = al[idx]!!
        var offset = a.size
        var n = 0

        while ((1.let { offset = offset shr it; offset }) > 0) {
            val nn = n + offset
            if (a[nn] <= id) {
                n = nn
            }
        }
        if (a[n] == id) {
            if (rv != null) {
                fillReturnValue(rv, idx, n)
            }
            return true
        }
        return false
    }

    companion object {
        protected const val MAXLISTS: Int = 31 // enough for size Int.MAX_VALUE
    }
}
