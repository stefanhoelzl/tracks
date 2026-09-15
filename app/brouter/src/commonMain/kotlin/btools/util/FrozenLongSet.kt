package btools.util

/**
 * Frozen instance of Memory efficient Set
 * 
 * 
 * This one is readily sorted into a singe array for faster access
 * 
 * @author ab
 */
class FrozenLongSet(set: CompactLongSet) : CompactLongSet() {
    private val faid: LongArray
    private var size = 0
    private var p2size: Int // next power of 2 of size

    init {
        size = set.size()

        faid = LongArray(size)

        set.moveToFrozenArray(faid)

        p2size = 0x40000000
        while (p2size > size) p2size = p2size shr 1
    }

    public override fun add(id: Long): Boolean {
        throw RuntimeException("cannot add on FrozenLongSet")
    }

    public override fun fastAdd(id: Long) {
        throw RuntimeException("cannot add on FrozenLongSet")
    }

    /**
     * @return the number of entries in this set
     */
    public override fun size(): Int {
        return size
    }


    /**
     * @return true if "id" is contained in this set.
     */
    public override fun contains(id: Long): Boolean {
        if (size == 0) {
            return false
        }
        val a = faid
        var offset = p2size
        var n = 0

        while (offset > 0) {
            val nn = n + offset
            if (nn < size && a[nn] <= id) {
                n = nn
            }
            offset = offset shr 1
        }
        return a[n] == id
    }
}
