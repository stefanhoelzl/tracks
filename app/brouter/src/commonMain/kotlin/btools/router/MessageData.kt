/**
 * Information on matched way point
 * 
 * @author ab
 */
package btools.router
import kotlin.jvm.JvmField


class MessageData {
    @JvmField
    var linkdist: Int = 0
    @JvmField
    var linkelevationcost: Int = 0
    @JvmField
    var linkturncost: Int = 0
    @JvmField
    var linknodecost: Int = 0
    @JvmField
    var linkinitcost: Int = 0

    @JvmField
    var costfactor: Float = 0f
    var prio: Int = 0
    @JvmField
    var classifiermask: Int = 0
    @JvmField
    var turnangle: Float = 0f
    @JvmField
    var wayKeyValues: String? = null
    @JvmField
    var nodeKeyValues: String? = null

    @JvmField
    var lon: Int = 0
    @JvmField
    var lat: Int = 0
    @JvmField
    var ele: Short = 0

    @JvmField
    var time: Float = 0f
    @JvmField
    var energy: Float = 0f

    // speed profile
    @JvmField
    var vmaxExplicit: Int = -1
    @JvmField
    var vmax: Int = -1
    @JvmField
    var vmin: Int = -1
    @JvmField
    var vnode0: Int = 999
    @JvmField
    var vnode1: Int = 999
    @JvmField
    var extraTime: Int = 0

    fun toMessage(): String? {
        if (wayKeyValues == null) {
            return null
        }

        val iCost = (costfactor * 1000 + 0.5f).toInt()
        return ((lon - 180000000).toString() + "\t"
                + (lat - 90000000) + "\t"
                + ele / 4 + "\t"
                + linkdist + "\t"
                + iCost + "\t"
                + linkelevationcost
                + "\t" + linkturncost
                + "\t" + linknodecost
                + "\t" + linkinitcost
                + "\t" + wayKeyValues
                + "\t" + (if (nodeKeyValues == null) "" else nodeKeyValues)
                + "\t" + (time.toInt())
                + "\t" + (energy.toInt()))
    }

    fun add(d: MessageData) {
        linkdist += d.linkdist
        linkelevationcost += d.linkelevationcost
        linkturncost += d.linkturncost
        linknodecost += d.linknodecost
        linkinitcost += d.linkinitcost
    }

    fun copy(): MessageData? {
        val c = MessageData()
        c.linkdist = linkdist
        c.linkelevationcost = linkelevationcost
        c.linkturncost = linkturncost
        c.linknodecost = linknodecost
        c.linkinitcost = linkinitcost
        c.costfactor = costfactor
        c.prio = prio
        c.classifiermask = classifiermask
        c.turnangle = turnangle
        c.wayKeyValues = wayKeyValues
        c.nodeKeyValues = nodeKeyValues
        c.lon = lon
        c.lat = lat
        c.ele = ele
        c.time = time
        c.energy = energy
        c.vmaxExplicit = vmaxExplicit
        c.vmax = vmax
        c.vmin = vmin
        c.vnode0 = vnode0
        c.vnode1 = vnode1
        c.extraTime = extraTime
        return c
    }

    override fun toString(): String {
        return "dist=" + linkdist + " prio=" + this.prio + " turn=" + turnangle
    }

    val isBadOneway: Boolean
        get() = (classifiermask and 1) != 0

    val isGoodOneway: Boolean
        get() = (classifiermask and 2) != 0

    val isRoundabout: Boolean
        get() = (classifiermask and 4) != 0

    val isLinktType: Boolean
        get() = (classifiermask and 8) != 0

    val isGoodForCars: Boolean
        get() = (classifiermask and 16) != 0
}
