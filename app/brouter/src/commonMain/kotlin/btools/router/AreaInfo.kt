package btools.router

import btools.expressions.BExpressionContext
import kotlin.math.abs
import kotlin.jvm.JvmField

class AreaInfo(@JvmField var direction: Int) {
    @JvmField
    var numForest: Int = -1
    @JvmField
    var numRiver: Int = -1

    @JvmField
    var polygon: OsmNogoPolygon? = null

    @JvmField
    var ways: Int = 0
    @JvmField
    var greenWays: Int = 0
    @JvmField
    var riverWays: Int = 0
    @JvmField
    var elevStart: Double = 0.0
    @JvmField
    var elev50: Int = 0

    fun checkAreaInfo(expctxWay: BExpressionContext, elev: Double, ab: ByteArray) {
        ways++

        val test = elevStart - elev
        if (abs(test) < 50) elev50++

        val ld2 = expctxWay.createNewLookupData()!!
        expctxWay.decode(ld2, false, ab)

        if (numForest != -1 && ld2[numForest] > 1) {
            greenWays++
        }

        if (numRiver != -1 && ld2[numRiver] > 1) {
            riverWays++
        }
    }

    val elev50Weight: Int
        get() {
            if (ways == 0) return 0
            return (elev50 * 100.0 / ways).toInt()
        }

    val green: Int
        get() {
            if (ways == 0) return 0
            return (greenWays * 100.0 / ways).toInt()
        }

    val river: Int
        get() {
            if (ways == 0) return 0
            return (riverWays * 100.0 / ways).toInt()
        }

    override fun toString(): String {
        val sb = StringBuilder()
        sb.append("Area ").append(direction).append(" ").append(elevStart).append("m ways ").append(ways)
        if (ways > 0) {
            sb.append("\nArea ways <50m  ").append(elev50).append(" ").append(this.elev50Weight).append("%")
            sb.append("\nArea ways green ").append(greenWays).append(" ").append(this.green).append("%")
            sb.append("\nArea ways river ").append(riverWays).append(" ").append(this.river).append("%")
        }
        return sb.toString()
    }

    companion object {
        const val RESULT_TYPE_NONE: Int = 0
        const val RESULT_TYPE_ELEV50: Int = 1
        const val RESULT_TYPE_GREEN: Int = 4
        const val RESULT_TYPE_RIVER: Int = 5
    }
}
