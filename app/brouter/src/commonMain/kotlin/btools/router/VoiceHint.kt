/**
 * Container for a voice hint
 * (both input- and result data for voice hint processing)
 * 
 * @author ab
 */
package btools.router

import kotlin.math.abs
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

class VoiceHint {
    @JvmField
    var ilon: Int = 0
    @JvmField
    var ilat: Int = 0
    @JvmField
    var selev: Short = 0
    @JvmField
    var cmd: Int = 0
    @JvmField
    var oldWay: MessageData? = null
    @JvmField
    var goodWay: MessageData? = null
    @JvmField
    var badWays: MutableList<MessageData>? = null
    @JvmField
    var distanceToNext: Double = 0.0
    @JvmField
    var indexInTrack: Int = 0

    val time: Float
        get() = if (oldWay == null) 0f else oldWay!!.time

    @JvmField
    var angle: Float = Float.MAX_VALUE
    @JvmField
    var lowerBadWayAngle: Float = -181f
    @JvmField
    var higherBadWayAngle: Float = 181f

    @JvmField
    var turnAngleConsumed: Boolean = false
    @JvmField
    var needsRealTurn: Boolean = false
    @JvmField
    var maxBadPrio: Int = -1

    var exitNumber: Int = 0

    val isRoundabout: Boolean
        get() = this.exitNumber != 0

    fun addBadWay(badWay: MessageData?) {
        if (badWay == null) {
            return
        }
        if (badWays == null) {
            badWays = ArrayList<MessageData>()
        }
        badWays!!.add(badWay)
    }

    fun calcCommand() {
        if (badWays != null) {
            for (badWay in badWays) {
                if (badWay.isBadOneway) {
                    continue
                }
                if (lowerBadWayAngle < badWay.turnangle && badWay.turnangle < goodWay!!.turnangle) {
                    lowerBadWayAngle = badWay.turnangle
                }
                if (higherBadWayAngle > badWay.turnangle && badWay.turnangle > goodWay!!.turnangle) {
                    higherBadWayAngle = badWay.turnangle
                }
            }
        }

        var cmdAngle = angle

        // fall back to local angle if otherwise inconsistent
        //if ( lowerBadWayAngle > angle || higherBadWayAngle < angle )
        //{
        //cmdAngle = goodWay.turnangle;
        //}
        if (angle == Float.MAX_VALUE) {
            cmdAngle = goodWay!!.turnangle
        }
        if (cmd == BL) return

        if (this.exitNumber > 0) {
            cmd = RNDB
        } else if (this.exitNumber < 0) {
            cmd = RNLB
        } else if (is180DegAngle(cmdAngle) && cmdAngle <= -179f && higherBadWayAngle == 181f && lowerBadWayAngle == -181f) {
            cmd = TU
        } else if (cmdAngle < -159f) {
            cmd = TLU
        } else if (cmdAngle < -135f) {
            cmd = TSHL
        } else if (cmdAngle < -45f) {
            // a TL can be pushed in either direction by a close-by alternative
            if (cmdAngle < -95f && higherBadWayAngle < -30f && lowerBadWayAngle < -180f) {
                cmd = TSHL
            } else if (cmdAngle > -85f && lowerBadWayAngle > -180f && higherBadWayAngle > -10f) {
                cmd = TSLL
            } else {
                if (cmdAngle < -110f) {
                    cmd = TSHL
                } else if (cmdAngle > -60f) {
                    cmd = TSLL
                } else {
                    cmd = TL
                }
            }
        } else if (cmdAngle < -21f) {
            if (cmd != KR) { // don't overwrite KR with TSLL
                cmd = TSLL
            }
        } else if (cmdAngle < -5f) {
            if (lowerBadWayAngle < -100f && higherBadWayAngle < 45f) {
                cmd = TSLL
            } else if (lowerBadWayAngle >= -100f && higherBadWayAngle < 45f) {
                cmd = KL
            } else {
                if (lowerBadWayAngle > -35f && higherBadWayAngle > 55f) {
                    cmd = KR
                } else {
                    cmd = C
                }
            }
        } else if (cmdAngle < 5f) {
            if (lowerBadWayAngle > -30f) {
                cmd = KR
            } else if (higherBadWayAngle < 30f) {
                cmd = KL
            } else {
                cmd = C
            }
        } else if (cmdAngle < 21f) {
            // a TR can be pushed in either direction by a close-by alternative
            if (lowerBadWayAngle > -45f && higherBadWayAngle > 100f) {
                cmd = TSLR
            } else if (lowerBadWayAngle > -45f && higherBadWayAngle <= 100f) {
                cmd = KR
            } else {
                if (lowerBadWayAngle < -55f && higherBadWayAngle < 35f) {
                    cmd = KL
                } else {
                    cmd = C
                }
            }
        } else if (cmdAngle < 45f) {
            cmd = TSLR
        } else if (cmdAngle < 135f) {
            if (cmdAngle < 85f && higherBadWayAngle < 180f && lowerBadWayAngle < 10f) {
                cmd = TSLR
            } else if (cmdAngle > 95f && lowerBadWayAngle > 30f && higherBadWayAngle > 180f) {
                cmd = TSHR
            } else {
                if (cmdAngle > 110.0) {
                    cmd = TSHR
                } else if (cmdAngle < 60.0) {
                    cmd = TSLR
                } else {
                    cmd = TR
                }
            }
        } else if (cmdAngle < 159f) {
            cmd = TSHR
        } else if (is180DegAngle(cmdAngle) && cmdAngle >= 179f && higherBadWayAngle == 181f && lowerBadWayAngle == -181f) {
            cmd = TU
        } else {
            cmd = TRU
        }
    }

    fun formatGeometry(): String {
        val oldPrio: Float = if (oldWay == null) 0f else oldWay!!.prio.toFloat()
        val sb = StringBuilder(30)
        sb.append(' ').append(oldPrio.toInt())
        appendTurnGeometry(sb, goodWay!!)
        if (badWays != null) {
            for (badWay in badWays) {
                sb.append(" ")
                appendTurnGeometry(sb, badWay)
            }
        }
        return sb.toString()
    }

    private fun appendTurnGeometry(sb: StringBuilder, msg: MessageData) {
        sb.append("(").append((msg.turnangle + 0.5).toInt()).append(")").append((msg.prio))
    }

    fun hasGiveWay(): Boolean {
        if (oldWay != null && oldWay!!.nodeKeyValues != null) {
            if (oldWay!!.wayKeyValues!!.contains("reversedirection=yes")) {
                return (oldWay!!.nodeKeyValues!!.contains("highway=give_way") || oldWay!!.nodeKeyValues!!.contains("highway=stop")) && oldWay!!.nodeKeyValues!!.contains(
                    "direction=backward"
                )
            } else {
                return (oldWay!!.nodeKeyValues!!.contains("highway=give_way") || oldWay!!.nodeKeyValues!!.contains("highway=stop")) && !oldWay!!.nodeKeyValues!!.contains(
                    "direction=backward"
                )
            }
        }
        return false
    }

    companion object {
        const val C: Int = 1 // continue (go straight)
        const val TL: Int = 2 // turn left
        const val TSLL: Int = 3 // turn slightly left
        const val TSHL: Int = 4 // turn sharply left
        const val TR: Int = 5 // turn right
        const val TSLR: Int = 6 // turn slightly right
        const val TSHR: Int = 7 // turn sharply right
        const val KL: Int = 8 // keep left
        const val KR: Int = 9 // keep right
        const val TLU: Int = 10 // U-turn
        const val TRU: Int = 11 // Right U-turn
        const val OFFR: Int = 12 // Off route
        const val RNDB: Int = 13 // Roundabout
        const val RNLB: Int = 14 // Roundabout left
        const val TU: Int = 15 // 180 degree u-turn
        const val BL: Int = 16 // Beeline routing
        const val EL: Int = 17 // exit left
        const val ER: Int = 18 // exit right

        const val END: Int = 100 // end point

        @JvmStatic
        fun is180DegAngle(angle: Float): Boolean {
            return (abs(angle) <= 180f && abs(angle) >= 179f)
        }
    }
}
