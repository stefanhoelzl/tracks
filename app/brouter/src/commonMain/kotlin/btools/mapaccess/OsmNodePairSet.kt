/**
 * Set holding pairs of osm nodes
 * 
 * @author ab
 */
package btools.mapaccess

import btools.util.CompactLongMap

class OsmNodePairSet(maxTempNodeCount: Int) {
    private val n1a: LongArray
    private val n2a: LongArray
    private var tempNodes = 0
    var maxTmpNodes: Int = 0
        private set
    private var npairs = 0
    var freezeCount: Int = 0
        private set

    private class OsmNodePair {
        var node2: Long = 0
        var next: OsmNodePair? = null
    }

    private var map: CompactLongMap<OsmNodePair?>? = null

    init {
        this.maxTmpNodes = maxTempNodeCount
        n1a = LongArray(this.maxTmpNodes)
        n2a = LongArray(this.maxTmpNodes)
    }

    fun addTempPair(n1: Long, n2: Long) {
        if (tempNodes < this.maxTmpNodes) {
            n1a[tempNodes] = n1
            n2a[tempNodes] = n2
            tempNodes++
        }
    }

    fun freezeTempPairs() {
        this.freezeCount++
        for (i in 0..<tempNodes) {
            addPair(n1a[i], n2a[i])
        }
        tempNodes = 0
    }

    fun clearTempPairs() {
        tempNodes = 0
    }

    private fun addPair(n1: Long, n2: Long) {
        if (map == null) {
            map = CompactLongMap<OsmNodePair?>()
        }
        npairs++

        var e = getElement(n1, n2)
        if (e == null) {
            e = OsmNodePair()
            e.node2 = n2

            var e0 = map!!.get(n1)
            if (e0 != null) {
                while (e0!!.next != null) {
                    e0 = e0.next
                }
                e0.next = e
            } else {
                map!!.fastPut(n1, e)
            }
        }
    }

    fun size(): Int {
        return npairs
    }

    fun tempSize(): Int {
        return tempNodes
    }

    fun hasPair(n1: Long, n2: Long): Boolean {
        return map != null && (getElement(n1, n2) != null || getElement(n2, n1) != null)
    }

    private fun getElement(n1: Long, n2: Long): OsmNodePair? {
        var e = map!!.get(n1)
        while (e != null) {
            if (e.node2 == n2) {
                return e
            }
            e = e.next
        }
        return null
    }
}
