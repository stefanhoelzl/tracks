package btools.util

/**
 * Memory efficient Set for long-keys
 * 
 * @author ab
 */
open class CompactLongSet {
    private var al: Array<LongArray?>?
    private val pa: IntArray
    private var size = 0
    private val _maxKeepExponent = 14 // the maximum exponent to keep the invalid arrays

    init {
        // pointer array
        pa = IntArray(MAXLISTS)

        // allocate key lists
        al = arrayOfNulls<LongArray>(MAXLISTS)
        al!![0] = LongArray(1) // make the first array (the transient buffer)
    }


    /**
     * @return the number of entries in this set
     */
    open fun size(): Int {
        return size
    }

    /**
     * add a long value to this set if not yet in.
     * 
     * @param id the value to add to this set.
     * @return true if "id" already contained in this set.
     */
    open fun add(id: Long): Boolean {
        if (contains(id)) {
            return true
        }
        _add(id)
        return false
    }

    open fun fastAdd(id: Long) {
        _add(id)
    }

    private fun _add(id: Long) {
        require(size != Int.MAX_VALUE) { "cannot grow beyond size Int.MAX_VALUE" }

        // put the new entry in the first array
        al!![0]!![0] = id

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
        if (al!![idx] == null) {
            al!![idx] = LongArray(n)
        }

        // now merge the contents of arrays 0...idx-1 into idx
        while (n > 0) {
            var maxId: Long = 0
            var maxIdx = -1

            for (i in 0..<idx) {
                val p = pa[i]
                if (p > 0) {
                    val currentId = al!![i]!![p - 1]
                    if (maxIdx < 0 || currentId > maxId) {
                        maxIdx = i
                        maxId = currentId
                    }
                }
            }

            // current maximum found, copy to target array
            require(!(n < al!![idx]!!.size && maxId == al!![idx]!![n])) { "duplicate key found in late check: " + maxId }
            --n
            al!![idx]!![n] = maxId

            --pa[maxIdx]
        }

        // de-allocate empty arrays of a certain size (fix at 64kByte)
        while (idx-- > _maxKeepExponent) {
            al!![idx] = null
        }
    }

    /**
     * @return true if "id" is contained in this set.
     */
    open fun contains(id: Long): Boolean {
        // determine the first empty array
        var bp = size // treat size as bitpattern
        var idx = 1

        while (bp != 0) {
            if ((bp and 1) == 1) {
                // array at idx is valid, check
                if (contains(idx, id)) {
                    return true
                }
            }
            idx++
            bp = bp shr 1
        }
        return false
    }


    // does sorted array "a" contain "id" ?
    private fun contains(idx: Int, id: Long): Boolean {
        val a = al!![idx]!!
        var offset = a.size
        var n = 0

        while ((1.let { offset = offset shr it; offset }) > 0) {
            val nn = n + offset
            if (a[nn] <= id) {
                n = nn
            }
        }
        return a[n] == id
    }

    fun moveToFrozenArray(faid: LongArray) {
        for (i in 1..<MAXLISTS) {
            pa[i] = 0
        }

        for (ti in 0..<size) { // target-index
            var bp = size // treat size as bitpattern
            var minIdx = -1
            var minId: Long = 0
            var idx = 1
            while (bp != 0) {
                if ((bp and 1) == 1) {
                    val p = pa[idx]
                    if (p < al!![idx]!!.size) {
                        val currentId = al!![idx]!![p]
                        if (minIdx < 0 || currentId < minId) {
                            minIdx = idx
                            minId = currentId
                        }
                    }
                }
                idx++
                bp = bp shr 1
            }
            faid[ti] = minId
            pa[minIdx]++

            require(!(ti > 0 && faid[ti - 1] == minId)) { "duplicate key found in late check: " + minId }
        }

        // free the non-frozen array
        al = null
    }

    companion object {
        protected const val MAXLISTS: Int = 31 // enough for size Int.MAX_VALUE
    }
}
