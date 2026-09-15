/**
 * Container for an osm node
 * 
 * @author ab
 */
package btools.mapaccess

import btools.codec.MicroCache
import btools.codec.MicroCache2
import btools.util.CheapRuler.distance
import btools.util.IByteArrayUnifier
import kotlin.math.max
import kotlin.jvm.JvmField

open class OsmNode : OsmLink, OsmPos {
    // interface OsmPos
    /**
     * The latitude
     */
    override var iLat: Int = 0

    /**
     * The longitude
     */
    override var iLon: Int = 0

    /**
     * The elevation
     */
    override var sElev: Short = Short.MIN_VALUE

    /**
     * The node-tags, if any
     */
    @JvmField
    var nodeDescription: ByteArray? = null

    @JvmField
    var firstRestriction: TurnRestriction? = null

    @JvmField
    var visitID: Int = 0

    fun addTurnRestriction(tr: TurnRestriction) {
        tr.next = firstRestriction
        firstRestriction = tr
    }

    /**
     * The links to other nodes
     */
    @JvmField
    var firstlink: OsmLink? = null

    constructor()

    constructor(ilon: Int, ilat: Int) {
        this.iLon = ilon
        this.iLat = ilat
    }

    constructor(id: Long) {
        this.iLon = (id shr 32).toInt()
        this.iLat = (id and 0xffffffffL).toInt()
    }


    override val elev: Double
        get() = this.sElev / 4.0

    fun addLink(link: OsmLink, isReverse: Boolean, tn: OsmNode) {
        require(link !== firstlink) { "UUUUPS" }

        if (isReverse) {
            link.n1 = tn
            link.n2 = this
            link.next = tn.firstlink
            link.previous = firstlink
            tn.firstlink = link
            firstlink = link
        } else {
            link.n1 = this
            link.n2 = tn
            link.next = firstlink
            link.previous = tn.firstlink
            tn.firstlink = link
            firstlink = link
        }
    }

    override fun calcDistance(p: OsmPos): Int {
        return max(1.0, btools.kmp.JMath.round(distance(this.iLon, this.iLat, p.iLon, p.iLat)).toDouble()).toInt()
    }

    override fun toString(): String {
        return "n_" + (this.iLon - 180000000) + "_" + (this.iLat - 90000000)
    }

    fun parseNodeBody(mc: MicroCache, hollowNodes: OsmNodesMap, expCtxWay: IByteArrayUnifier) {
        if (mc is MicroCache2) {
            parseNodeBody2(mc, hollowNodes, expCtxWay)
        } else throw IllegalArgumentException("unknown cache version: " + mc::class)
    }

    fun parseNodeBody2(mc: MicroCache2, hollowNodes: OsmNodesMap, expCtxWay: IByteArrayUnifier) {
        val abUnifier = hollowNodes.byteArrayUnifier

        // read turn restrictions
        while (mc.readBoolean()) {
            val tr = TurnRestriction()
            tr.exceptions = mc.readShort()
            tr.isPositive = mc.readBoolean()
            tr.fromLon = mc.readInt()
            tr.fromLat = mc.readInt()
            tr.toLon = mc.readInt()
            tr.toLat = mc.readInt()
            addTurnRestriction(tr)
        }

        this.sElev = mc.readShort()
        val nodeDescSize = mc.readVarLengthUnsigned()
        nodeDescription = if (nodeDescSize == 0) null else mc.readUnified(nodeDescSize, abUnifier)

        while (mc.hasMoreData()) {
            // read link data
            val endPointer = mc.endPointer
            val linklon = this.iLon + mc.readVarLengthSigned()
            val linklat = this.iLat + mc.readVarLengthSigned()
            val sizecode = mc.readVarLengthUnsigned()
            val isReverse = (sizecode and 1) != 0
            var description: ByteArray? = null
            val descSize = sizecode shr 1
            if (descSize > 0) {
                description = mc.readUnified(descSize, expCtxWay)
            }
            val geometry = mc.readDataUntil(endPointer)

            addLink(linklon, linklat, description, geometry, hollowNodes, isReverse)
        }
        hollowNodes.remove(this)
    }

    fun addLink(
        linklon: Int,
        linklat: Int,
        description: ByteArray?,
        geometry: ByteArray?,
        hollowNodes: OsmNodesMap,
        isReverse: Boolean
    ) {
        if (linklon == this.iLon && linklat == this.iLat) {
            return  // skip self-ref
        }

        var tn: OsmNode? = null // find the target node
        var link: OsmLink? = null

        // ...in our known links
        var l = firstlink
        while (l != null) {
            val t = l.getTarget(this)
            if (t!!.iLon == linklon && t.iLat == linklat) {
                tn = t
                if (isReverse || (l.descriptionBitmap == null && !l.isReverse(this))) {
                    link = l // the correct one that needs our data
                    break
                }
            }
            l = l.getNext(this)
        }
        if (tn == null) { // .. not found, then check the hollow nodes
            tn = hollowNodes.get(linklon, linklat) // target node
            if (tn == null) { // node not yet known, create a new hollow proxy
                tn = OsmNode(linklon, linklat)
                tn.setHollow()
                hollowNodes.put(tn)
                addLink(tn.also { link = it }, isReverse, tn) // technical inheritance: link instance in node
            }
        }
        if (link == null) {
            addLink(OsmLink().also { link = it }, isReverse, tn)
        }
        if (!isReverse) {
            link!!.descriptionBitmap = description
            link.geometry = geometry
        }
    }


    val isHollow: Boolean
        get() = sElev.toInt() == -12345

    fun setHollow() {
        this.sElev = -12345
    }

    override val idFromPos: Long
        get() = (iLon.toLong()) shl 32 or iLat.toLong()

    fun vanish() {
        if (!this.isHollow) {
            var l = firstlink
            while (l != null) {
                val target = l.getTarget(this)
                val nextLink = l.getNext(this)
                if (!target!!.isHollow) {
                    unlinkLink(l)
                    if (!l.isLinkUnused) {
                        target.unlinkLink(l)
                    }
                }
                l = nextLink
            }
        }
    }

    fun unlinkLink(link: OsmLink) {
        val n = link.clear(this)

        if (link === firstlink) {
            firstlink = n
            return
        }
        var l = firstlink
        while (l != null) {
            // if ( l.isReverse( this ) )
            if (l.n1 !== this && l.n1 != null) { // isReverse inline
                val nl = l.previous
                if (nl === link) {
                    l.previous = n
                    return
                }
                l = nl
            } else if (l.n2 !== this && l.n2 != null) {
                val nl = l.next
                if (nl === link) {
                    l.next = n
                    return
                }
                l = nl
            } else {
                throw IllegalArgumentException("unlinkLink: unknown source")
            }
        }
    }


    override fun equals(o: Any?): Boolean {
        return (o as OsmNode).iLon == this.iLon && o.iLat == this.iLat
    }

    override fun hashCode(): Int {
        return this.iLon + this.iLat
    }
}
