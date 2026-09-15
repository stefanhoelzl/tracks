package btools.codec
import btools.kmp.System

/**
 * Special integer fifo suitable for 3-pass encoding
 */
class IntegerFifo3Pass(capacity: Int) {
    private var a: IntArray
    private var size = 0
    private var pos = 0

    private var pass = 0

    init {
        a = if (capacity < 4) IntArray(4) else IntArray(capacity)
    }

    /**
     * Starts a new encoding pass and resets the reading pointer
     * from the stats collected in pass2 and writes that to the given context
     */
    fun init() {
        pass++
        pos = 0
    }

    /**
     * writes to the fifo in pass2
     */
    fun add(value: Int) {
        if (pass == 2) {
            if (size == a.size) {
                val aa = IntArray(2 * size)
                System.arraycopy(a, 0, aa, 0, size)
                a = aa
            }
            a[size++] = value
        }
    }

    val next: Int
        /**
         * reads from the fifo in pass3 (in pass1/2 returns just 1)
         */
        get() = if (pass == 3) get(pos++) else 1

    private fun get(idx: Int): Int {
        if (idx >= size) {
            throw IndexOutOfBoundsException("list size=" + size + " idx=" + idx)
        }
        return a[idx]
    }
}
