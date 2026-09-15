package btools.util
import btools.kmp.System
import kotlin.jvm.JvmField

/**
 * Memory efficient Map to map a long-key to an object-value
 * 
 * 
 * Implementation is such that basically the 12 bytes
 * per entry is allocated that's needed to store
 * a long- and an object-value.
 * This class does not implement the Map interface
 * because it's not complete (remove() is not implemented,
 * CompactLongMap can only grow.)
 * 
 * @author ab
 */
open class CompactLongMap<V> {
    private var al: Array<LongArray?>?
    private val pa: IntArray
    private var size = 0
    private val _maxKeepExponent = 14 // the maximum exponent to keep the invalid arrays

    @JvmField
    protected var value_in: V? = null
    @JvmField
    protected var value_out: V? = null

    /*
   *
   * The Map extension:
   * next 5 protected methods are needed to implement value-support
   * overwrite them all to support value structures other than the
   * long-values implemented here as a sample.
   *
   * Furthermore, put() and get() method need to be implemented
   * to access the values.
   *
   * Note that this map does not behave exactly like java.util.Map
   * - put(..) with already existing key throws exception
   * - get(..) with non-existing key thros exception
   *
   * If you have keys that cannot easily be mapped on long's, use
   * a hash-function to do the mapping. But note that, in comparison
   * to java.util.HashMap, in that case the keys itself are not saved,
   * only the hash-values, so you need to be sure that random duplicate
   * hashs are either excluded by the structure of your data or that
   * you can handle the possible IllegalArgumentException
   *
   */
    private var vla: Array<Array<Any?>?>? // value list array


    init {
        // pointer array
        pa = IntArray(MAXLISTS)

        // allocate key lists
        al = arrayOfNulls<LongArray>(MAXLISTS)
        al!![0] = LongArray(1) // make the first array (the transient buffer)

        // same for the values
        vla = arrayOfNulls<Array<Any?>>(MAXLISTS)
        vla!![0] = arrayOfNulls<Any>(1)

        earlyDuplicateCheck = System.getBoolean("earlyDuplicateCheck")
    }


    open fun put(id: Long, value: V?): Boolean {
        try {
            value_in = value
            if (contains(id, true)) {
                return true
            }
            vla!![0]!![0] = value
            _add(id)
            return false
        } finally {
            value_in = null
            value_out = null
        }
    }

    /**
     * Same as put( id, value ) but duplicate check
     * is skipped for performance. Be aware that you
     * can get a duplicate exception later on if the
     * map is restructured!
     * with System parameter earlyDuplicateCheck=true you
     * can enforce the early duplicate check for debugging
     * 
     * @param id    the key to insert
     * @param value the value to insert object
     * @throws IllegalArgumentException for duplicates if enabled
     */
    open fun fastPut(id: Long, value: V?) {
        require(!(earlyDuplicateCheck && contains(id))) { "duplicate key found in early check: " + id }
        vla!![0]!![0] = value
        _add(id)
    }

    /**
     * Get the value for the given id
     * 
     * @param id the key to query
     * @return the object, or null if id not known
     */
    open fun get(id: Long): V? {
        try {
            if (contains(id, false)) {
                return value_out
            }
            return null
        } finally {
            value_out = null
        }
    }


    /**
     * @return the number of entries in this map
     */
    open fun size(): Int {
        return size
    }


    private fun _add(id: Long): Boolean {
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
            vla!![idx] = arrayOfNulls<Any>(n)
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
            vla!![idx]!![n] = vla!![maxIdx]!![pa[maxIdx] - 1]

            --pa[maxIdx]
        }

        // de-allocate empty arrays of a certain size (fix at 64kByte)
        while (idx-- > _maxKeepExponent) {
            al!![idx] = null
            vla!![idx] = null
        }

        return false
    }

    /**
     * @return true if "id" is contained in this set.
     */
    fun contains(id: Long): Boolean {
        try {
            return contains(id, false)
        } finally {
            value_out = null
        }
    }

    protected open fun contains(id: Long, doPut: Boolean): Boolean {
        // determine the first empty array
        var bp = size // treat size as bitpattern
        var idx = 1

        while (bp != 0) {
            if ((bp and 1) == 1) {
                // array at idx is valid, check
                if (contains(idx, id, doPut)) {
                    return true
                }
            }
            idx++
            bp = bp shr 1
        }
        return false
    }


    // does sorted array "a" contain "id" ?
    private fun contains(idx: Int, id: Long, doPut: Boolean): Boolean {
        val a = al!![idx]!!
        var offset = a.size
        var n = 0

        while ((1.let { offset = offset shr it; offset }) > 0) {
            val nn = n + offset
            if (a[nn] <= id) {
                n = nn
            }
        }
        if (a[n] == id) {
            value_out = vla!![idx]!![n] as V?
            if (doPut) vla!![idx]!![n] = value_in
            return true
        }
        return false
    }

    fun moveToFrozenArrays(faid: LongArray, flv: MutableList<V?>) {
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
            flv.add(vla!![minIdx]!![pa[minIdx]] as V?)
            pa[minIdx]++

            require(!(ti > 0 && faid[ti - 1] == minId)) { "duplicate key found in late check: " + minId }
        }

        // free the non-frozen arrays
        al = null
        vla = null
    }

    companion object {
        protected const val MAXLISTS: Int = 31 // enough for size Int.MAX_VALUE
        private var earlyDuplicateCheck: Boolean = false
    }
}
