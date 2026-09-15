/**
 * Container for link between two Osm nodes
 * 
 * @author ab
 */
package btools.mapaccess


import btools.util.ByteArrayUnifier
import btools.kmp.System
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

class OsmNodesMap {
    private val hmap: MutableMap<OsmNode?, OsmNode> = HashMap<OsmNode?, OsmNode>(4096)

    val byteArrayUnifier: ByteArrayUnifier = ByteArrayUnifier(16384, false)

    private val testKey = OsmNode()

    @JvmField
    var nodesCreated: Int = 0
    @JvmField
    var maxmem: Long = 0
    private var currentmaxmem: Long = 4000000 // start with 4 MB
    var lastVisitID: Int = 1000
    var baseID: Int = 1000

    @JvmField
    var destination: OsmNode? = null
    @JvmField
    var currentPathCost: Int = 0
    @JvmField
    var currentMaxCost: Int = 1000000000

    @JvmField
    var endNode1: OsmNode? = null
    @JvmField
    var endNode2: OsmNode? = null

    @JvmField
    var cleanupMode: Int = 0

    fun cleanupAndCount(nodes: Array<OsmNode>) {
        if (cleanupMode == 0) {
            justCount(nodes)
        } else {
            cleanupPeninsulas(nodes)
        }
    }

    private fun justCount(nodes: Array<OsmNode>) {
        for (i in nodes.indices) {
            val n = nodes[i]
            if (n.firstlink != null) {
                nodesCreated++
            }
        }
    }

    private fun cleanupPeninsulas(nodes: Array<OsmNode>) {
        baseID = lastVisitID++
        for (i in nodes.indices) { // loop over nodes again just for housekeeping
            val n = nodes[i]
            if (n.firstlink != null) {
                if (n.visitID == 1) {
                    minVisitIdInSubtree(null, n)
                }
            }
        }
    }

    /** One level of the walk that BRouter's Java does as a recursive call. */
    private class PeninsulaFrame {
        var source: OsmNode? = null
        var n: OsmNode? = null
        var minId = 0
        var link: OsmLink? = null
        /** The link being descended into, while its subtree is walked. */
        var pending: OsmLink? = null
        var pendingTarget: OsmNode? = null
        var nodesCreatedUntilHere = 0
    }

    private val peninsulaFrames = ArrayList<PeninsulaFrame>()

    private fun minVisitIdInSubtree(source: OsmNode?, root: OsmNode): Int {
        var depth = 0
        enterPeninsulaFrame(depth, source, root)
        var returned = 0

        while (true) {
            val frame = peninsulaFrames[depth]
            val n = frame.n!!

            // A subtree has just returned `returned`: finish the loop iteration that descended into it.
            val pending = frame.pending
            if (pending != null) {
                if (returned > n.visitID) { // peninsula ?
                    nodesCreated = frame.nodesCreatedUntilHere
                    n.unlinkLink(pending)
                    frame.pendingTarget!!.unlinkLink(pending)
                }
                if (returned < frame.minId) frame.minId = returned
                frame.pending = null
                frame.pendingTarget = null
            }

            var child: OsmNode? = null
            while (frame.link != null) {
                val l = frame.link!!
                val nextLink = l.getNext(n)

                val t = l.getTarget(n)
                if (t === frame.source) {
                    frame.link = nextLink
                    continue
                }
                if (t!!.isHollow) {
                    frame.link = nextLink
                    continue
                }

                var minIdSub = t.visitID
                if (minIdSub == 1) {
                    minIdSub = baseID
                } else if (minIdSub == 0) {
                    frame.nodesCreatedUntilHere = nodesCreated
                    frame.pending = l
                    frame.pendingTarget = t
                    frame.link = nextLink
                    child = t
                    break
                } else if (minIdSub < baseID) {
                    frame.link = nextLink
                    continue
                } else if (cleanupMode == 2) {
                    minIdSub = baseID // in tree-mode, hitting anything is like a gateway
                }
                if (minIdSub < frame.minId) frame.minId = minIdSub
                frame.link = nextLink
            }

            if (child != null) {
                depth++
                enterPeninsulaFrame(depth, n, child)
                continue
            }

            returned = frame.minId
            frame.source = null
            frame.n = null
            if (depth == 0) return returned
            depth--
        }
    }

    private fun enterPeninsulaFrame(depth: Int, source: OsmNode?, n: OsmNode) {
        if (depth == peninsulaFrames.size) peninsulaFrames.add(PeninsulaFrame())
        if (n.visitID == 1) n.visitID = baseID // border node
        else n.visitID = lastVisitID++
        nodesCreated++
        val frame = peninsulaFrames[depth]
        frame.source = source
        frame.n = n
        frame.minId = n.visitID
        frame.link = n.firstlink
    }


    fun isInMemoryBounds(npaths: Int, extend: Boolean): Boolean {
//    long total = nodesCreated * 76L + linksCreated * 48L;
        var total = nodesCreated * 95L + npaths * 200L

        if (extend) {
            total += 100000

            // when extending, try to have 1 MB  space
            val delta = total + 1900000 - currentmaxmem
            if (delta > 0) {
                currentmaxmem += delta
                if (currentmaxmem > maxmem) {
                    currentmaxmem = maxmem
                }
            }
        }
        return total <= currentmaxmem
    }

    private var nodes2check: MutableList<OsmNode>? = null

    // is there an escape from this node
    // to a hollow node (or destination node) ?
    fun canEscape(n0: OsmNode?): Boolean {
        var sawLowIDs = false
        lastVisitID++
        nodes2check!!.clear()
        nodes2check!!.add(n0!!)
        while (!nodes2check!!.isEmpty()) {
            val n = nodes2check!!.removeAt(nodes2check!!.size - 1)
            if (n.visitID < baseID) {
                n.visitID = lastVisitID
                nodesCreated++
                var l = n.firstlink
                while (l != null) {
                    val t = l.getTarget(n)
                    nodes2check!!.add(t!!)
                    l = l.getNext(n)
                }
            } else if (n.visitID < lastVisitID) {
                sawLowIDs = true
            }
        }
        if (sawLowIDs) {
            return true
        }

        nodes2check!!.add(n0)
        while (!nodes2check!!.isEmpty()) {
            val n = nodes2check!!.removeAt(nodes2check!!.size - 1)
            if (n.visitID == lastVisitID) {
                n.visitID = lastVisitID
                nodesCreated--
                var l = n.firstlink
                while (l != null) {
                    val t = l.getTarget(n)
                    nodes2check!!.add(t!!)
                    l = l.getNext(n)
                }
                n.vanish()
            }
        }

        return false
    }

    private fun addActiveNode(nodes2check: MutableList<OsmNode>, n: OsmNode) {
        n.visitID = lastVisitID
        nodesCreated++
        nodes2check.add(n)
    }

    fun clearTemp() {
        nodes2check = null
    }

    fun collectOutreachers() {
        nodes2check = ArrayList<OsmNode>(nodesCreated)
        nodesCreated = 0
        for (n in hmap.values) {
            addActiveNode(nodes2check!!, n)
        }

        lastVisitID++
        baseID = lastVisitID

        while (!nodes2check!!.isEmpty()) {
            val n = nodes2check!!.removeAt(nodes2check!!.size - 1)
            n.visitID = lastVisitID

            var l = n.firstlink
            while (l != null) {
                val t = l.getTarget(n)
                if (t!!.visitID != lastVisitID) {
                    addActiveNode(nodes2check!!, t)
                }
                l = l.getNext(n)
            }
            if (destination != null && currentMaxCost < 1000000000) {
                val distance = n.calcDistance(destination!!)
                if (distance > currentMaxCost - currentPathCost + 100) {
                    n.vanish()
                }
            }
            if (n.firstlink == null) {
                nodesCreated--
            }
        }
    }


    /**
     * Get a node from the map
     * 
     * @return the node for the given id if exist, else null
     */
    fun get(ilon: Int, ilat: Int): OsmNode? {
        testKey.iLon = ilon
        testKey.iLat = ilat
        return hmap.get(testKey)
    }


    fun remove(node: OsmNode?) {
        if (node !== endNode1 && node !== endNode2) { // keep endnodes in hollow-map even when loaded
            hmap.remove(node) // (needed for escape analysis)
        }
    }

    /**
     * Put a node into the map
     * 
     * @return the previous node if that id existed, else null
     */
    fun put(node: OsmNode?): OsmNode? {
        return hmap.put(node, node!!)
    }

    companion object {
        // ********************** test cleanup **********************
        private fun addLinks(nodes: Array<OsmNode>, idx: Int, isBorder: Boolean, links: IntArray) {
            val n = nodes[idx]
            n.visitID = if (isBorder) 1 else 0
            n.sElev = idx.toShort()
            for (i in links) {
                val t = nodes[i]
                var link: OsmLink? = if (n.isLinkUnused) n else (if (t.isLinkUnused) t else null)
                if (link == null) {
                    link = OsmLink()
                }
                n.addLink(link, false, t)
            }
        }

        @JvmStatic
        fun main(args: Array<String>) {
            val nodes: Array<OsmNode> = (arrayOfNulls<OsmNode>(12) as Array<OsmNode>)
            for (i in nodes.indices) {
                nodes[i] = OsmNode((i + 1000) * 1000, (i + 1000) * 1000)
            }

            addLinks(nodes, 0, true, intArrayOf(1, 5)) // 0
            addLinks(nodes, 1, true, intArrayOf()) // 1
            addLinks(nodes, 2, false, intArrayOf(3, 4)) // 2
            addLinks(nodes, 3, false, intArrayOf(4)) // 3
            addLinks(nodes, 4, false, intArrayOf()) // 4
            addLinks(nodes, 5, true, intArrayOf(6, 9)) // 5
            addLinks(nodes, 6, false, intArrayOf(7, 8)) // 6
            addLinks(nodes, 7, false, intArrayOf()) // 7
            addLinks(nodes, 8, false, intArrayOf()) // 8
            addLinks(nodes, 9, false, intArrayOf(10, 11)) // 9
            addLinks(nodes, 10, false, intArrayOf(11)) // 10
            addLinks(nodes, 11, false, intArrayOf()) // 11

            val nm = OsmNodesMap()

            nm.cleanupMode = 2

            nm.cleanupAndCount(nodes)

            println("nodesCreated=" + nm.nodesCreated)
            nm.cleanupAndCount(nodes)

            println("nodesCreated=" + nm.nodesCreated)
        }
    }
}
