/**
 * Information on matched way point
 * 
 * @author ab
 */
package btools.mapaccess

import btools.kmp.io.DataInput
import btools.kmp.io.DataOutput
import btools.kmp.io.IOException
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

class MatchedWaypoint {
    @JvmField
    var node1: OsmNode? = null
    @JvmField
    var node2: OsmNode? = null
    @JvmField
    var crosspoint: OsmNode? = null
    @JvmField
    var waypoint: OsmNode? = null
    @JvmField
    var correctedpoint: OsmNode? = null
    @JvmField
    var name: String? = null // waypoint name used in error messages
    @JvmField
    var radius: Double = 0.0 // distance in meter between waypoint and crosspoint
    @JvmField
    var wpttype: Byte = WAYPOINT_TYPE_SHAPING
    @JvmField
    var indexInTrack: Int = 0
    @JvmField
    var directionToNext: Double = -1.0
    @JvmField
    var directionDiff: Double = 361.0

    @JvmField
    var wayNearest: MutableList<MatchedWaypoint> = ArrayList<MatchedWaypoint>()
    @JvmField
    var hasUpdate: Boolean = false

    @Throws(IOException::class)
    fun writeToStream(dos: DataOutput) {
        dos.writeInt(node1!!.iLat)
        dos.writeInt(node1!!.iLon)
        dos.writeInt(node2!!.iLat)
        dos.writeInt(node2!!.iLon)
        dos.writeInt(crosspoint!!.iLat)
        dos.writeInt(crosspoint!!.iLon)
        dos.writeInt(waypoint!!.iLat)
        dos.writeInt(waypoint!!.iLon)
        dos.writeDouble(radius)
        dos.writeByte(wpttype.toInt())
        dos.writeShort(name!!.length)
        dos.writeBytes(name!!)
    }

    companion object {
        const val WAYPOINT_TYPE_SHAPING: Byte = 1 // route next to this point
        const val WAYPOINT_TYPE_MEETING: Byte = 2 // visit this point
        const val WAYPOINT_TYPE_DIRECT: Byte = 3 // from this point go direct to next = beeline routing

        @JvmStatic
        @Throws(IOException::class)
        fun readFromStream(dis: DataInput): MatchedWaypoint {
            val mwp = MatchedWaypoint()
            mwp.node1 = OsmNode()
            mwp.node2 = OsmNode()
            mwp.crosspoint = OsmNode()
            mwp.waypoint = OsmNode()

            mwp.node1!!.iLat = dis.readInt()
            mwp.node1!!.iLon = dis.readInt()
            mwp.node2!!.iLat = dis.readInt()
            mwp.node2!!.iLon = dis.readInt()
            mwp.crosspoint!!.iLat = dis.readInt()
            mwp.crosspoint!!.iLon = dis.readInt()
            mwp.waypoint!!.iLat = dis.readInt()
            mwp.waypoint!!.iLon = dis.readInt()
            mwp.radius = dis.readDouble()
            mwp.wpttype = dis.readByte()
            val len = dis.readShort().toInt()
            val bytes = ByteArray(len)
            dis.readFully(bytes)
            mwp.name = bytes.decodeToString()
            return mwp
        }
    }
}
