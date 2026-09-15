/**
 * Processor for Voice Hints
 * 
 * @author ab
 */
package btools.router

import btools.router.VoiceHint.Companion.is180DegAngle
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class VoiceHintProcessor // this.catchingRange = catchingRange;
    (
    catchingRange: Double, // private double catchingRange; // range to catch angles and merge turns
    private val explicitRoundabouts: Boolean, private val transportMode: Int
) {
    var SIGNIFICANT_ANGLE: Double = 22.5
    var INTERNAL_CATCHING_RANGE_NEAR: Double = 2.0
    var INTERNAL_CATCHING_RANGE_WIDE: Double = 10.0

    private fun sumNonConsumedWithinCatchingRange(inputs: MutableList<VoiceHint>, offset: Int, range: Double): Float {
        var offset = offset
        var distance = 0.0
        var angle = 0f
        while (offset >= 0 && distance < range) {
            val input = inputs.get(offset--)
            if (input.turnAngleConsumed || input.cmd == VoiceHint.BL || input.cmd == VoiceHint.END) {
                break
            }
            angle += input.goodWay!!.turnangle
            distance += input.goodWay!!.linkdist.toDouble()
            input.turnAngleConsumed = true
        }
        return angle
    }


    /**
     * process voice hints. Uses VoiceHint objects
     * for both input and output. Input is in reverse
     * order (from target to start), but output is
     * returned in travel-direction and only for
     * those nodes that trigger a voice hint.
     * 
     * 
     * Input objects are expected for every segment
     * of the track, also for those without a junction
     * 
     * 
     * VoiceHint objects in the output list are enriched
     * by the voice-command, the total angle and the distance
     * to the next hint
     * 
     * @param inputs tracknodes, un reverse order
     * @return voice hints, in forward order
     */
    fun process(inputs: MutableList<VoiceHint>): MutableList<VoiceHint> {
        val results: MutableList<VoiceHint> = ArrayList<VoiceHint>()
        var distance = 0.0
        var roundAboutTurnAngle = 0f // sums up angles in roundabout

        var roundaboutExit = 0
        var roundaboudStartIdx = -1

        for (hintIdx in inputs.indices) {
            val input = inputs.get(hintIdx)

            if (input.cmd == VoiceHint.BL) {
                results.add(input)
                continue
            }

            val turnAngle = input.goodWay!!.turnangle
            if (hintIdx != 0) distance += input.goodWay!!.linkdist.toDouble()

            val currentPrio = input.goodWay!!.prio
            val oldPrio = input.oldWay!!.prio
            val minPrio = min(oldPrio, currentPrio)

            val isLink2Highway = input.oldWay!!.isLinktType && !input.goodWay!!.isLinktType
            val isHighway2Link = !input.oldWay!!.isLinktType && input.goodWay!!.isLinktType

            if (explicitRoundabouts && input.oldWay!!.isRoundabout) {
                if (roundaboudStartIdx == -1) roundaboudStartIdx = hintIdx
                roundAboutTurnAngle += sumNonConsumedWithinCatchingRange(inputs, hintIdx, INTERNAL_CATCHING_RANGE_NEAR)
                if (roundaboudStartIdx == hintIdx) {
                    if (input.badWays != null) {
                        // remove goodWay
                        roundAboutTurnAngle -= input.goodWay!!.turnangle
                        // add a badWay
                        for (badWay in input.badWays) {
                            if (!badWay.isBadOneway) roundAboutTurnAngle += badWay.turnangle
                        }
                    }
                }
                var isExit = roundaboutExit == 0 // exit point is always exit
                if (input.badWays != null) {
                    for (badWay in input.badWays) {
                        if (!badWay.isBadOneway &&
                            badWay.isGoodForCars
                        ) {
                            isExit = true
                            break
                        }
                    }
                }
                if (isExit) {
                    roundaboutExit++
                }
                continue
            }
            if (roundaboutExit > 0) {
                input.angle = roundAboutTurnAngle
                input.goodWay!!.turnangle = roundAboutTurnAngle
                input.distanceToNext = distance
                input.turnAngleConsumed = true
                //input.roundaboutExit = startTurn < 0 ? roundaboutExit : -roundaboutExit;
                input.exitNumber = if (roundAboutTurnAngle < 0) roundaboutExit else -roundaboutExit
                var tmpangle = 0f
                val tmpRndAbt = VoiceHint()
                tmpRndAbt.badWays = ArrayList<MessageData>()
                for (i in hintIdx - 1 downTo roundaboudStartIdx + 1) {
                    val vh = inputs.get(i)
                    tmpangle += inputs.get(i).goodWay!!.turnangle
                    if (vh.badWays != null) {
                        for (badWay in vh.badWays) {
                            if (!badWay.isBadOneway) {
                                val md = MessageData()
                                md.linkdist = vh.goodWay!!.linkdist
                                md.prio = vh.goodWay!!.prio
                                md.turnangle = tmpangle
                                tmpRndAbt.badWays!!.add(md)
                            }
                        }
                    }
                }
                distance = 0.0

                input.badWays = tmpRndAbt.badWays

                results.add(input)
                roundAboutTurnAngle = 0f
                roundaboutExit = 0
                roundaboudStartIdx = -1
                continue
            }

            val inputNext = if (hintIdx + 1 < inputs.size) inputs.get(hintIdx + 1) else null

            var maxPrioAll = -1 // max prio of all detours
            var maxPrioCandidates = -1 // max prio of real candidates

            var maxAngle = -180f
            var minAngle = 180f
            var minAbsAngeRaw = 180f

            var isBadwayLink = false

            if (input.badWays != null) {
                for (badWay in input.badWays) {
                    val badPrio = badWay.prio
                    val badTurn = badWay.turnangle
                    if (badWay.isLinktType) {
                        isBadwayLink = true
                    }
                    val isBadHighway2Link = !input.oldWay!!.isLinktType && badWay.isLinktType

                    if (badPrio > maxPrioAll) {
                        maxPrioAll = badPrio
                        input.maxBadPrio = max(input.maxBadPrio, badPrio)
                    }

                    if (badWay.isBadOneway) {
                        if (minAbsAngeRaw == 180f) minAbsAngeRaw = abs(turnAngle) // disable hasSomethingMoreStraight

                        continue  // ignore wrong oneways
                    }

                    if (abs(badTurn) - abs(turnAngle) > 80f) {
                        if (minAbsAngeRaw == 180f) minAbsAngeRaw = abs(turnAngle) // disable hasSomethingMoreStraight

                        continue  // ways from the back should not trigger a slight turn
                    }

                    if (badWay.costfactor < 20f && abs(badTurn) < minAbsAngeRaw) {
                        minAbsAngeRaw = abs(badTurn)
                    }

                    if (badPrio > maxPrioCandidates) {
                        maxPrioCandidates = badPrio
                        input.maxBadPrio = max(input.maxBadPrio, badPrio)
                    }
                    if (badTurn > maxAngle) {
                        maxAngle = badTurn
                    }
                    if (badTurn < minAngle) {
                        minAngle = badTurn
                    }
                }
            }

            // has a significant angle and one or more bad ways around
            // https://brouter.de/brouter-test/#map=17/53.07509/-0.95780/standard&lonlats=-0.95757,53.073428;-0.95727,53.076064&profile=car-eco
            val hasSomethingMoreStraight = (abs(turnAngle) > 35f) && input.badWays != null

            // bad way has more prio, but is not a link
            //
            val noLinkButBadWayPrio = (maxPrioAll > minPrio && !isLink2Highway)

            // bad way has more prio
            //
            val badWayHasPrio = (maxPrioCandidates > currentPrio)

            // is a u-turn - same way back
            // https://brouter.de/brouter-test/#map=16/51.0608/13.7707/standard&lonlats=13.7658,51.060989;13.767893,51.061628;13.765273,51.062953&pois=13.76739,51.061609,Biergarten2956
            val isUTurn = is180DegAngle(turnAngle)

            // way has prio, but also has an angle
            // https://brouter.de/brouter-test/#map=15/47.7925/16.2582/standard&lonlats=16.24952,47.785458;16.269679,47.794653&profile=car-eco
            val isBadWayLinkButNoLink = (!isHighway2Link && isBadwayLink && abs(turnAngle) > 5f)

            //
            // https://brouter.de/brouter-test/#map=14/47.7927/16.2848/standard&lonlats=16.267617,47.795275;16.286438,47.787354&profile=car-eco
            val isLinkButNoBadWayLink = (isHighway2Link && !isBadwayLink && abs(turnAngle) < 5f)

            // way has same prio, but bad way has smaller angle and is not a bad link and prio is near
            // small: https://brouter.de/brouter-test/#map=17/49.40750/8.69257/standard&lonlats=8.692461,49.407997;8.694028,49.408478&profile=car-eco
            // high:  https://brouter.de/brouter-test/#map=14/52.9951/-0.5786/standard&lonlats=-0.59261,52.991576;-0.583606,52.998947&profile=car-eco
            val samePrioSmallBadAngle =
                (currentPrio == oldPrio) && (minPrio - maxPrioAll <= 2) && !isBadwayLink && minAbsAngeRaw != 180f && minAbsAngeRaw < 35f

            // way has prio, but has to give way
            // https://brouter.de/brouter-test/#map=15/54.1344/-4.6015/standard&lonlats=-4.605432,54.136747;-4.609336,54.130058&profile=car-eco
            val mustGiveWay =
                transportMode != VoiceHintList.TRANS_MODE_FOOT && input.badWays != null && !badWayHasPrio &&
                        (input.hasGiveWay() || (inputNext != null && inputNext.hasGiveWay()))

            // unconditional triggers are all junctions with
            // - higher detour prios than the minimum route prio (except link->highway junctions)
            // - or candidate detours with higher prio then the route exit leg
            val unconditionalTrigger = hasSomethingMoreStraight ||
                    noLinkButBadWayPrio ||
                    badWayHasPrio ||
                    isUTurn ||
                    isBadWayLinkButNoLink ||
                    isLinkButNoBadWayLink ||
                    samePrioSmallBadAngle ||
                    mustGiveWay

            // conditional triggers (=real turning angle required) are junctions
            // with candidate detours equal in priority than the route exit leg
            val conditionalTrigger = maxPrioCandidates >= minPrio

            if (unconditionalTrigger || conditionalTrigger) {
                input.angle = turnAngle
                input.calcCommand()
                val isStraight = input.cmd == VoiceHint.C
                input.needsRealTurn = (!unconditionalTrigger) && isStraight

                // check for KR/KL
                if (abs(turnAngle) > 5.0) { // don't use too small angles
                    if (maxAngle < turnAngle && maxAngle > turnAngle - 45f - (max(turnAngle, 0f))) {
                        input.cmd = VoiceHint.KR
                    }
                    if (minAngle > turnAngle && minAngle < turnAngle + 45f - (min(turnAngle, 0f))) {
                        input.cmd = VoiceHint.KL
                    }
                }

                if (explicitRoundabouts) {
                    input.angle = sumNonConsumedWithinCatchingRange(inputs, hintIdx, INTERNAL_CATCHING_RANGE_WIDE)
                } else {
                    input.turnAngleConsumed = true
                }
                input.distanceToNext = distance
                distance = 0.0
                results.add(input)
            }
            if (results.size > 0 && distance < INTERNAL_CATCHING_RANGE_NEAR) { //catchingRange
                results.get(results.size - 1).angle += sumNonConsumedWithinCatchingRange(
                    inputs,
                    hintIdx,
                    INTERNAL_CATCHING_RANGE_NEAR
                )
            }
        }

        // go through the hint list again in reverse order (=travel direction)
        // and filter out non-significant hints and hints too close to its predecessor
        val results2: MutableList<VoiceHint> = ArrayList<VoiceHint>()
        var i = results.size
        while (i > 0) {
            var hint = results.get(--i)
            if (hint.cmd == 0) {
                hint.calcCommand()
            }
            if (hint.cmd == VoiceHint.END) {
                results2.add(hint)
                continue
            }
            if (!(hint.needsRealTurn && (hint.cmd == VoiceHint.C || hint.cmd == VoiceHint.BL))) {
                var dist = hint.distanceToNext
                // sum up other hints within the catching range (e.g. 40m)
                while (dist < INTERNAL_CATCHING_RANGE_NEAR && i > 0) {
                    val h2 = results.get(i - 1)
                    dist = h2.distanceToNext
                    hint.distanceToNext += dist
                    hint.angle += h2.angle
                    i--
                    if (h2.isRoundabout) { // if we hit a roundabout, use that as the trigger
                        h2.angle = hint.angle
                        hint = h2
                        break
                    }
                }

                if (!explicitRoundabouts) {
                    hint.exitNumber = 0 // use an angular hint instead
                }
                hint.calcCommand()
                results2.add(hint)
            } else if (hint.cmd == VoiceHint.BL) {
                results2.add(hint)
            } else {
                if (results2.size > 0) results2.get(results2.size - 1)!!.distanceToNext += hint.distanceToNext
            }
        }
        return results2
    }

    fun postProcess(inputs: MutableList<VoiceHint>, catchingRange: Double, minRange: Double): MutableList<VoiceHint> {
        val results: MutableList<VoiceHint> = ArrayList<VoiceHint>()
        var inputLast: VoiceHint? = null
        var inputLastSaved: VoiceHint? = null
        var hintIdx = 0
        while (hintIdx < inputs.size) {
            val input = inputs.get(hintIdx)
            var nextInput: VoiceHint? = null
            if (hintIdx + 1 < inputs.size) {
                nextInput = inputs.get(hintIdx + 1)
            }

            if (input.cmd == VoiceHint.BL) {
                results.add(input)
                hintIdx++
                continue
            }

            if (nextInput == null) {
                if (input.cmd == VoiceHint.END) {
                    hintIdx++
                    continue
                } else if ((input.cmd == VoiceHint.C || input.cmd == VoiceHint.KR || input.cmd == VoiceHint.KL)
                    && !input.goodWay!!.isLinktType
                ) {
                    if (checkStraightHold(input, inputLastSaved, minRange)) {
                        results.add(input)
                    } else {
                        if (inputLast != null) { // when drop add distance to last
                            inputLast.distanceToNext += input.distanceToNext
                        }
                        hintIdx++
                        continue
                    }
                } else {
                    results.add(input)
                }
            } else {
                if ((inputLastSaved != null && inputLastSaved.distanceToNext > catchingRange) || input.distanceToNext > catchingRange) {
                    if ((input.cmd == VoiceHint.C || input.cmd == VoiceHint.KR || input.cmd == VoiceHint.KL)) {
                        if (checkStraightHold(input, inputLastSaved, minRange)) {
                            // add only on prio
                            results.add(input)
                            inputLastSaved = input
                        } else {
                            if (inputLastSaved != null) { // when drop add distance to last
                                inputLastSaved.distanceToNext += input.distanceToNext
                            }
                        }
                    } else if ((input.goodWay!!.prio == 29 && input.maxBadPrio == 30) &&
                        checkForNextNoneMotorway(inputs, hintIdx, 3)
                    ) {
                        // leave motorway
                        if (input.cmd == VoiceHint.KR || input.cmd == VoiceHint.TSLR) {
                            input.cmd = VoiceHint.ER
                        } else if (input.cmd == VoiceHint.KL || input.cmd == VoiceHint.TSLL) {
                            input.cmd = VoiceHint.EL
                        }
                        results.add(input)
                        inputLastSaved = input
                    } else {
                        // add all others
                        // ignore motorway / primary continue
                        if (((input.goodWay!!.prio != 28) &&
                                    (input.goodWay!!.prio != 30) &&
                                    (input.goodWay!!.prio != 26))
                            || input.isRoundabout
                            || abs(input.angle) > 21f || (abs(input.angle) - input.lowerBadWayAngle) < 21f
                        ) {
                            results.add(input)
                            inputLastSaved = input
                        } else {
                            if (inputLastSaved != null) { // when drop add distance to last
                                inputLastSaved.distanceToNext += input.distanceToNext
                            }
                        }
                    }
                } else if (input.distanceToNext < catchingRange) {
                    var dist = input.distanceToNext
                    var angles = input.angle
                    var save = false

                    dist += nextInput.distanceToNext
                    angles += nextInput.angle

                    if ((input.cmd == VoiceHint.C || input.cmd == VoiceHint.KR || input.cmd == VoiceHint.KL)
                        && !input.goodWay!!.isLinktType
                    ) {
                        if (input.goodWay!!.prio < input.maxBadPrio) {
                            if (inputLastSaved != null && inputLastSaved.cmd != VoiceHint.C && (inputLastSaved != null && inputLastSaved.distanceToNext > minRange)
                                && transportMode != VoiceHintList.TRANS_MODE_CAR
                            ) {
                                // add when straight and not linktype
                                // and last vh not straight
                                save = true
                                // remove when next straight and not linktype
                                if (nextInput != null && nextInput.cmd == VoiceHint.C && !nextInput.goodWay!!.isLinktType) {
                                    input.distanceToNext += nextInput.distanceToNext
                                    hintIdx++
                                }
                            }
                        } else {
                            if (inputLastSaved != null) { // when drop add distance to last
                                inputLastSaved.distanceToNext += input.distanceToNext
                            }
                        }
                    } else if ((input.goodWay!!.prio == 29 && input.maxBadPrio == 30)) {
                        // leave motorway
                        if (input.cmd == VoiceHint.KR || input.cmd == VoiceHint.TSLR) {
                            input.cmd = VoiceHint.ER
                        } else if (input.cmd == VoiceHint.KL || input.cmd == VoiceHint.TSLL) {
                            input.cmd = VoiceHint.EL
                        }
                        save = true
                    } else if (is180DegAngle(input.angle)) {
                        // add u-turn, 180 degree
                        save = true
                    } else if (transportMode == VoiceHintList.TRANS_MODE_CAR && abs(angles) > 180 - SIGNIFICANT_ANGLE) {
                        // add when inc car mode and u-turn, collects e.g. two left turns in range
                        input.angle = angles
                        input.calcCommand()
                        input.distanceToNext += nextInput.distanceToNext
                        save = true
                        hintIdx++
                    } else if (abs(angles) < SIGNIFICANT_ANGLE && input.distanceToNext < minRange) {
                        input.angle = angles
                        input.calcCommand()
                        input.distanceToNext += nextInput.distanceToNext
                        save = true
                        hintIdx++
                    } else if (abs(input.angle) > SIGNIFICANT_ANGLE) {
                        // add when angle above 22.5 deg
                        save = true
                    } else if (abs(input.angle) < SIGNIFICANT_ANGLE) {
                        // add when angle below 22.5 deg ???
                        // save = true;
                    } else {
                        // otherwise ignore but add distance to next
                        // when drop add distance to last
                        nextInput.distanceToNext += input.distanceToNext
                        save = false
                    }

                    if (save) {
                        results.add(input) // add when last
                        inputLastSaved = input
                    }
                } else {
                    results.add(input)
                    inputLastSaved = input
                }
            }
            inputLast = input
            hintIdx++
        }
        if (results.size > 0) {
            // don't use END tag
            if (results.get(results.size - 1)!!.cmd == VoiceHint.END) results.removeAt(results.size - 1)
        }

        return results
    }

    fun checkForNextNoneMotorway(inputs: MutableList<VoiceHint>, offset: Int, testsize: Int): Boolean {
        var i = 1
        while (i < testsize + 1 && offset + i < inputs.size) {
            val prio = inputs.get(offset + i).goodWay!!.prio
            if (prio < 29) return true
            if (prio == 30) return false
            i++
        }
        return false
    }

    fun checkStraightHold(input: VoiceHint, inputLastSaved: VoiceHint?, minRange: Double): Boolean {
        if (input.indexInTrack == 0) return false

        var badOneWay = false
        if (input.badWays != null) {
            for (md in input.badWays) {
                if (md.isBadOneway) badOneWay = true
            }
        }
        if (badOneWay && input.lowerBadWayAngle == -181f && input.higherBadWayAngle == 181f) return false
        if ((input.lowerBadWayAngle != -181f && abs(input.lowerBadWayAngle) > 135f && abs(input.higherBadWayAngle) > 35f) ||
            (input.higherBadWayAngle != 181f && input.higherBadWayAngle > 135f && abs(input.lowerBadWayAngle) > 35f)
        ) return false

        return ((abs(input.lowerBadWayAngle) < 35f || input.higherBadWayAngle < 35f)
                || input.goodWay!!.prio < input.maxBadPrio || input.goodWay!!.prio > input.oldWay!!.prio)
                && (inputLastSaved == null || inputLastSaved.distanceToNext > minRange)
                && (input.distanceToNext > minRange)
    }
}
