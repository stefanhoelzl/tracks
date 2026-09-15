/**
 * The path-instance of the kinematic model
 * 
 * @author ab
 */
package btools.router

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

internal class KinematicPath : OsmPath() {
    private var ekin = 0.0 // kinetic energy (Joule)
    override var totalTime: Double = 0.0 // travel time (seconds)
        private set
    override var totalEnergy: Double = 0.0 // total route energy (Joule)
        private set
    private var floatingAngleLeft = 0f // sliding average left bend (degree)
    private var floatingAngleRight = 0f // sliding average right bend (degree)

    override fun init(orig: OsmPath?) {
        val origin = orig as KinematicPath
        ekin = origin.ekin
        totalTime = origin.totalTime
        totalEnergy = origin.totalEnergy
        floatingAngleLeft = origin.floatingAngleLeft
        floatingAngleRight = origin.floatingAngleRight
    }

    override fun resetState() {
        ekin = 0.0
        totalTime = 0.0
        totalEnergy = 0.0
        floatingAngleLeft = 0f
        floatingAngleRight = 0f
    }

    override fun processWaySection(
        rc: RoutingContext,
        dist: Double,
        delta_h: Double,
        elevation: Double,
        angle: Double,
        cosangle: Double,
        isStartpoint: Boolean,
        nsection: Int,
        lastpriorityclassifier: Int
    ): Double {
        val km = rc.pm as KinematicModel

        var cost = 0.0
        var extraTime = 0.0

        if (isStartpoint) {
            // for forward direction, we start with target speed
            if (!rc.inverseDirection) {
                extraTime = 0.5 * (1.0 - cosangle) * 40.0 // 40 seconds turn penalty
            }
        } else {
            var turnspeed = 999.0 // just high

            if (km.turnAngleDecayTime != 0.0) { // process turn-angle slowdown
                if (angle < 0) floatingAngleLeft -= angle.toFloat()
                else floatingAngleRight += angle.toFloat()
                val aa = max(floatingAngleLeft, floatingAngleRight)

                val curveSpeed = if (aa > 10.0) 200.0 / aa else 20.0
                val distanceTime = dist / curveSpeed
                val decayFactor = exp(-distanceTime / km.turnAngleDecayTime)
                floatingAngleLeft = (floatingAngleLeft * decayFactor).toFloat()
                floatingAngleRight = (floatingAngleRight * decayFactor).toFloat()

                if (curveSpeed < 20.0) {
                    turnspeed = curveSpeed
                }
            }

            if (nsection == 0) { // process slowdown by crossing geometry
                var junctionspeed = 999.0 // just high

                val classifiermask = rc.expctxWay.classifierMask.toInt()

                // penalty for equal priority crossing
                var hasLeftWay = false
                var hasRightWay = false
                var hasResidential = false
                var prePath = rc.firstPrePath
                while (prePath != null) {
                    val pp = prePath as KinematicPrePath

                    if (((pp.classifiermask xor classifiermask) and 8) != 0) { // exactly one is linktype
                        prePath = prePath.next
                        continue
                    }

                    if ((pp.classifiermask and 32) != 0) { // touching a residential?
                        hasResidential = true
                    }

                    if (pp.priorityclassifier > priorityclassifier || pp.priorityclassifier == priorityclassifier && priorityclassifier < 20) {
                        val diff = pp.angle - angle
                        if (diff < -40.0 && diff > -140.0) hasLeftWay = true
                        if (diff > 40.0 && diff < 140.0) hasRightWay = true
                    }
                    prePath = prePath.next
                }
                val residentialSpeed = 13.0

                if (hasLeftWay && junctionspeed > km.leftWaySpeed) junctionspeed = km.leftWaySpeed
                if (hasRightWay && junctionspeed > km.rightWaySpeed) junctionspeed = km.rightWaySpeed
                if (hasResidential && junctionspeed > residentialSpeed) junctionspeed = residentialSpeed

                if ((lastpriorityclassifier < 20) xor (priorityclassifier < 20)) {
                    extraTime += 10.0
                    junctionspeed = 0.0 // full stop for entering or leaving road network
                }

                if (lastpriorityclassifier != priorityclassifier && (classifiermask and 8) != 0) {
                    extraTime += 2.0 // two seconds for entering a link-type
                }
                turnspeed = if (turnspeed > junctionspeed) junctionspeed else turnspeed

                if (message != null) {
                    message!!.vnode0 = (junctionspeed * 3.6 + 0.5).toInt()
                }
            }
            cutEkin(km.totalweight, turnspeed) // apply turnspeed
        }

        val sectionCost = extraTime

        // linear temperature correction
        val tcorr = (20.0 - km.outside_temp) * 0.0035

        // air_pressure down 1mb/8m
        val ecorr = 0.0001375 * (elevation - 100.0)

        val f_air = km.f_air * (1.0 + tcorr - ecorr)

        val distanceCost = evolveDistance(km, dist, delta_h, f_air)


        val cf = rc.expctxWay.costfactor

        if (message != null) {
            message!!.costfactor = (distanceCost / dist).toFloat()
            message!!.vmax = (km.wayMaxspeed * 3.6 + 0.5).toInt()
            message!!.vmaxExplicit = (km.wayMaxspeedExplicit * 3.6 + 0.5).toInt()
            message!!.vmin = (km.wayMinspeed * 3.6 + 0.5).toInt()
            message!!.extraTime = (extraTime * 1000).toInt()
        }

        cost += dist * cf + 0.5f

        cost += (extraTime * km.pw / km.cost0)
        totalTime += extraTime

        cost += distanceCost

        return cost
    }


    protected fun evolveDistance(km: KinematicModel, dist: Double, delta_h: Double, f_air: Double): Double {
        // elevation force
        val fh = delta_h * km.totalweight * 9.81 / dist

        val effectiveSpeedLimit = km.effectiveSpeedLimit
        val emax = 0.5 * km.totalweight * effectiveSpeedLimit * effectiveSpeedLimit
        if (emax <= 0.0) {
            return -1.0
        }
        val vb = km.getBreakingSpeed(effectiveSpeedLimit)
        val elow = 0.5 * km.totalweight * vb * vb

        var elapsedTime = 0.0
        var dissipatedEnergy = 0.0

        var v = sqrt(2.0 * ekin / km.totalweight)
        var d = dist
        while (d > 0.0) {
            val slow = ekin < elow
            val fast = ekin >= emax
            val etarget = if (slow) elow else emax
            var f = km.f_roll + f_air * v * v + fh
            val f_recup =
                max(0.0, if (fast) -f else (if (slow) km.f_recup else 0.0) - fh) // additional recup for slow part
            f += f_recup

            var delta_ekin: Double
            val timeStep: Double
            var x: Double
            if (fast) {
                x = d
                delta_ekin = x * f
                timeStep = x / v
                ekin = etarget
            } else {
                delta_ekin = etarget - ekin
                val b = 2.0 * f_air / km.totalweight
                val x0 = delta_ekin / f
                val x0b = x0 * b
                x = x0 * (1.0 - x0b * (0.5 + x0b * (0.333333333 - x0b * 0.25))) // = ln( delta_ekin*b/f + 1.) / b;
                val maxstep = min(50.0, d)
                if (x >= maxstep) {
                    x = maxstep
                    val xb = x * b
                    delta_ekin = x * f * (1.0 + xb * (0.5 + xb * (0.166666667 + xb * 0.0416666667))) // = f/b* exp(xb-1)
                    ekin += delta_ekin
                } else {
                    ekin = etarget
                }
                val v2 = sqrt(2.0 * ekin / km.totalweight)
                val a = f / km.totalweight // TODO: average force?
                timeStep = (v2 - v) / a
                v = v2
            }
            d -= x
            elapsedTime += timeStep

            // dissipated energy does not contain elevation and efficient recup
            dissipatedEnergy += delta_ekin - x * (fh + f_recup * km.recup_efficiency)

            // correction: inefficient recup going into heating is half efficient
            val ieRecup = x * f_recup * (1.0 - km.recup_efficiency)
            val eaux = timeStep * km.p_standby
            dissipatedEnergy -= max(ieRecup, eaux) * 0.5
        }

        dissipatedEnergy += elapsedTime * km.p_standby

        totalTime += elapsedTime
        totalEnergy += dissipatedEnergy + dist * fh

        return (km.pw * elapsedTime + dissipatedEnergy) / km.cost0 // =cost
    }

    override fun processTargetNode(rc: RoutingContext): Double {
        val km = rc.pm as KinematicModel

        // finally add node-costs for target node
        if (targetNode!!.nodeDescription != null) {
            rc.expctxNode.evaluate(false, targetNode!!.nodeDescription!!)
            val initialcost = rc.expctxNode.initialcost
            if (initialcost >= 1000000.0) {
                return -1.0
            }
            cutEkin(km.totalweight, km.nodeMaxspeed.toDouble()) // apply node maxspeed

            if (message != null) {
                message!!.linknodecost += initialcost.toInt()
                message!!.nodeKeyValues = rc.expctxNode.getKeyValueDescription(false, targetNode!!.nodeDescription!!)

                message!!.vnode1 = (km.nodeMaxspeed * 3.6 + 0.5).toInt()
            }
            return initialcost.toDouble()
        }
        return 0.0
    }

    private fun cutEkin(weight: Double, speed: Double) {
        val e = 0.5 * weight * speed * speed
        if (ekin > e) ekin = e
    }


    public override fun elevationCorrection(): Int {
        return 0
    }

    public override fun definitlyWorseThan(path: OsmPath?): Boolean {
        val p = path as KinematicPath

        val c = p.cost
        return cost > c + 100
    }
}
