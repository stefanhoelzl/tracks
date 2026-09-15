package btools.router

import btools.mapaccess.OsmPos
import btools.util.CheapRuler.distance
import btools.kmp.io.DataInput
import btools.kmp.io.DataOutput
import btools.kmp.io.IOException
import kotlin.math.max
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

/**
 * Container for link between two Osm nodes
 * 
 * @author ab
 */
class OsmPathElement protected constructor() : OsmPos {
    // interface OsmPos
    override var iLat: Int = 0 // latitude
        private set
    override var iLon: Int = 0 // longitude
        private set
    override var sElev: Short = 0 // longitude

    @JvmField
    var message: MessageData? = null // description

    @JvmField
    var cost: Int = 0

    override val elev: Double
        get() = this.sElev / 4.0

    var time: Float
        get() = if (message == null) 0f else message!!.time
        set(t) {
            if (message != null) {
                message!!.time = t
            }
        }

    var energy: Float
        get() = if (message == null) 0f else message!!.energy
        set(e) {
            if (message != null) {
                message!!.energy = e
            }
        }

    fun setAngle(e: Float) {
        if (message != null) {
            message!!.turnangle = e
        }
    }

    override val idFromPos: Long
        get() = (iLon.toLong()) shl 32 or iLat.toLong()

    override fun calcDistance(p: OsmPos): Int {
        return max(1.0, btools.kmp.JMath.round(distance(this.iLon, this.iLat, p.iLon, p.iLat)).toDouble()).toInt()
    }

    @JvmField
    var origin: OsmPathElement? = null

    override fun toString(): String {
        return iLon.toString() + "_" + this.iLat
    }

    fun positionEquals(e: OsmPathElement): Boolean {
        return this.iLat == e.iLat && this.iLon == e.iLon
    }

    @Throws(IOException::class)
    fun writeToStream(dos: DataOutput) {
        dos.writeInt(this.iLat)
        dos.writeInt(this.iLon)
        dos.writeShort(sElev.toInt())
        dos.writeInt(cost)
    }

    companion object {
        // construct a path element from a path
        @JvmStatic
        fun create(path: OsmPath): OsmPathElement {
            val n = path.getTargetNode()
            val pe: OsmPathElement = create(n.iLon, n.iLat, n.sElev, path.originElement)
            pe.cost = path.cost
            pe.message = path.message
            return pe
        }

        @JvmStatic
        fun create(ilon: Int, ilat: Int, selev: Short, origin: OsmPathElement?): OsmPathElement {
            val pe = OsmPathElement()
            pe.iLon = ilon
            pe.iLat = ilat
            pe.sElev = selev
            pe.origin = origin
            return pe
        }

        @JvmStatic
        @Throws(IOException::class)
        fun readFromStream(dis: DataInput): OsmPathElement {
            val pe = OsmPathElement()
            pe.iLat = dis.readInt()
            pe.iLon = dis.readInt()
            pe.sElev = dis.readShort()
            pe.cost = dis.readInt()
            return pe
        }
    }
}
