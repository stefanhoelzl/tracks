package btools.util
import btools.kmp.System

/**
 * dynamic list of primitive longs
 * 
 * @author ab
 */
class LongList(capacity: Int) {
    private var a: LongArray
    private var size = 0

    init {
        a = if (capacity < 4) LongArray(4) else LongArray(capacity)
    }

    fun add(value: Long) {
        if (size == a.size) {
            val aa = LongArray(2 * size)
            System.arraycopy(a, 0, aa, 0, size)
            a = aa
        }
        a[size++] = value
    }

    fun get(idx: Int): Long {
        if (idx >= size) {
            throw IndexOutOfBoundsException("list size=" + size + " idx=" + idx)
        }
        return a[idx]
    }

    fun size(): Int {
        return size
    }
}
