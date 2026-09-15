package btools.kmp.util

/*
 * The few java.util classes BRouter's core uses that common Kotlin has no equivalent for. Behaviour follows
 * the JDK for what BRouter relies on (token order, sorted iteration, poll order).
 */

/** java.util.StringTokenizer without returnDelims. */
class StringTokenizer(private val str: String, private val delims: String = " \t\n\r") {
    private var pos = 0

    private fun skip() {
        while (pos < str.length && delims.indexOf(str[pos]) >= 0) pos++
    }

    fun hasMoreTokens(): Boolean {
        skip()
        return pos < str.length
    }

    fun nextToken(): String {
        skip()
        if (pos >= str.length) throw NoSuchElementException()
        val start = pos
        while (pos < str.length && delims.indexOf(str[pos]) < 0) pos++
        return str.substring(start, pos)
    }

    fun countTokens(): Int {
        var n = 0
        var p = pos
        while (true) {
            while (p < str.length && delims.indexOf(str[p]) >= 0) p++
            if (p >= str.length) return n
            while (p < str.length && delims.indexOf(str[p]) < 0) p++
            n++
        }
    }

    fun hasMoreElements() = hasMoreTokens()
    fun nextElement(): Any = nextToken()
}

/**
 * A sorted map (java.util.TreeMap's iteration order by natural key order, nulls not allowed as keys), backed
 * by a sorted array list with binary search. BRouter only uses it for small maps (tiles, statistics).
 */
class TreeMap<K, V>(private val comparator: Comparator<in K>? = null) : AbstractMutableMap<K, V>() {
    private val keyList = ArrayList<K>()
    private val valueList = ArrayList<V>()

    @Suppress("UNCHECKED_CAST")
    private fun cmp(a: K, b: K): Int =
        comparator?.compare(a, b) ?: (a as Comparable<K>).compareTo(b)

    private fun find(key: K): Int {
        var lo = 0
        var hi = keyList.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val c = cmp(keyList[mid], key)
            when {
                c < 0 -> lo = mid + 1
                c > 0 -> hi = mid - 1
                else -> return mid
            }
        }
        return -(lo + 1)
    }

    override fun put(key: K, value: V): V? {
        val i = find(key)
        return if (i >= 0) {
            valueList.set(i, value)
        } else {
            keyList.add(-i - 1, key)
            valueList.add(-i - 1, value)
            null
        }
    }

    override fun get(key: K): V? = find(key).let { if (it >= 0) valueList[it] else null }
    override fun containsKey(key: K): Boolean = find(key) >= 0
    override fun remove(key: K): V? {
        val i = find(key)
        if (i < 0) return null
        keyList.removeAt(i)
        return valueList.removeAt(i)
    }
    override fun clear() { keyList.clear(); valueList.clear() }
    override val size: Int get() = keyList.size

    fun firstKey(): K = if (keyList.isEmpty()) throw NoSuchElementException() else keyList[0]
    fun lastKey(): K = if (keyList.isEmpty()) throw NoSuchElementException() else keyList[keyList.size - 1]

    /** java.util.TreeMap.lastEntry(): null when empty; a snapshot entry (setValue unsupported). */
    fun lastEntry(): Map.Entry<K, V>? {
        if (keyList.isEmpty()) return null
        val k = keyList[keyList.size - 1]
        val v = valueList[valueList.size - 1]
        return object : Map.Entry<K, V> {
            override val key: K get() = k
            override val value: V get() = v
        }
    }

    override val entries: MutableSet<MutableMap.MutableEntry<K, V>>
        get() = object : AbstractMutableSet<MutableMap.MutableEntry<K, V>>() {
            override val size: Int get() = keyList.size
            override fun add(element: MutableMap.MutableEntry<K, V>): Boolean {
                put(element.key, element.value); return true
            }
            override fun iterator(): MutableIterator<MutableMap.MutableEntry<K, V>> = object : MutableIterator<MutableMap.MutableEntry<K, V>> {
                var i = 0
                var last = -1
                override fun hasNext() = i < keyList.size
                override fun next(): MutableMap.MutableEntry<K, V> {
                    if (i >= keyList.size) throw NoSuchElementException()
                    last = i
                    val idx = i++
                    return object : MutableMap.MutableEntry<K, V> {
                        override val key: K get() = keyList[idx]
                        override val value: V get() = valueList[idx]
                        override fun setValue(newValue: V): V = valueList.set(idx, newValue)
                        override fun toString() = "$key=$value"
                    }
                }
                override fun remove() {
                    check(last >= 0)
                    keyList.removeAt(last); valueList.removeAt(last)
                    i = last; last = -1
                }
            }
        }
}

/** java.util.PriorityQueue: poll() returns the least element by the comparator (binary heap). */
class PriorityQueue<E>(@Suppress("UNUSED_PARAMETER") initialCapacity: Int = 11, private val comparator: Comparator<in E>) {
    private val heap = ArrayList<E>()

    val size: Int get() = heap.size
    fun size(): Int = heap.size
    fun isEmpty(): Boolean = heap.isEmpty()

    fun add(e: E): Boolean {
        heap.add(e)
        var i = heap.size - 1
        while (i > 0) {
            val p = (i - 1) / 2
            if (comparator.compare(heap[i], heap[p]) >= 0) break
            val t = heap[i]; heap[i] = heap[p]; heap[p] = t
            i = p
        }
        return true
    }

    fun offer(e: E) = add(e)

    fun addAll(elements: Collection<E>): Boolean {
        elements.forEach { add(it) }
        return elements.isNotEmpty()
    }

    fun peek(): E? = heap.firstOrNull()

    fun poll(): E? {
        if (heap.isEmpty()) return null
        val top = heap[0]
        val last = heap.removeAt(heap.size - 1)
        if (heap.isNotEmpty()) {
            heap[0] = last
            var i = 0
            while (true) {
                val l = 2 * i + 1
                val r = l + 1
                var m = i
                if (l < heap.size && comparator.compare(heap[l], heap[m]) < 0) m = l
                if (r < heap.size && comparator.compare(heap[r], heap[m]) < 0) m = r
                if (m == i) break
                val t = heap[i]; heap[i] = heap[m]; heap[m] = t
                i = m
            }
        }
        return top
    }
}
