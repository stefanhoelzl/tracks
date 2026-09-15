package btools.kmp.util

/** java.util.Collections / Arrays helpers the core calls, as common Kotlin. Sorting is stable, like the JDK's. */
object JCollections {
    fun <T> sort(list: MutableList<T>, c: Comparator<in T>) = list.sortWith(c)
    fun <T : Comparable<T>> sort(list: MutableList<T>) = list.sort()

    fun <T : Comparable<T>> sortArray(a: Array<T>) = a.sort()
    fun sortArray(a: IntArray) = a.sort()
    fun sortArray(a: LongArray) = a.sort()

    fun fill(a: IntArray, v: Int) = a.fill(v)
    fun fill(a: LongArray, v: Long) = a.fill(v)
    fun fill(a: ByteArray, v: Byte) = a.fill(v)
    fun fill(a: ShortArray, v: Short) = a.fill(v)
    fun fill(a: BooleanArray, v: Boolean) = a.fill(v)
    fun <T> fill(a: Array<T>, v: T) = a.fill(v)
}
