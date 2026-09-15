package btools.util

/**
 * Behaves like an Array of list
 * with lazy list-allocation at getList
 * 
 * @author ab
 */
class LazyArrayOfLists<E>(size: Int) {
    private val lists: MutableList<ArrayList<E?>?>

    init {
        lists = ArrayList<ArrayList<E?>?>(size)
        for (i in 0..<size) {
            lists.add(null)
        }
    }

    fun getList(idx: Int): MutableList<E?> {
        var list = lists.get(idx)
        if (list == null) {
            list = ArrayList<E?>()
            lists.set(idx, list)
        }
        return list
    }

    fun getSize(idx: Int): Int {
        val list: MutableList<E?>? = lists.get(idx)
        return if (list == null) 0 else list.size
    }

    fun trimAll() {
        for (idx in lists.indices) {
            val list = lists.get(idx)
            if (list != null) {
                list.trimToSize()
            }
        }
    }
}
