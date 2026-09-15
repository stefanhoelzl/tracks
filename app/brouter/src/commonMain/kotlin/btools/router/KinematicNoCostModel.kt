/**
 * Container for link between two Osm nodes
 * 
 * @author ab
 */
package btools.router

import btools.expressions.BExpressionContextNode
import btools.expressions.BExpressionContextWay

internal class KinematicNoCostModel : OsmPathModel() {
    public override fun createPrePath(): OsmPrePath {
        return KinematicPrePath()
    }

    public override fun createPath(): OsmPath {
        return KinematicNoCostPath()
    }

    var turnAngleDecayTime: Double = 0.0
    var f_roll: Double = 0.0
    var f_air: Double = 0.0
    var f_recup: Double = 0.0
    var p_standby: Double = 0.0
    var outside_temp: Double = 0.0
    var recup_efficiency: Double = 0.0
    var totalweight: Double = 0.0
    var vmax: Double = 0.0
    var leftWaySpeed: Double = 0.0
    var rightWaySpeed: Double = 0.0

    // derived values
    var pw: Double = 0.0 // balance power
    var cost0: Double = 0.0 // minimum possible cost per meter

    private var wayIdxMaxspeed = 0
    private var wayIdxMaxspeedExplicit = 0
    private var wayIdxMinspeed = 0

    private var nodeIdxMaxspeed = 0

    protected var ctxWay: BExpressionContextWay? = null
    protected var ctxNode: BExpressionContextNode? = null
    protected var params: MutableMap<String?, String?>? = null

    private var initDone = false

    private var lastEffectiveLimit = 0.0
    private var lastBreakingSpeed = 0.0

    public override fun init(
        expctxWay: BExpressionContextWay,
        expctxNode: BExpressionContextNode,
        extraParams: MutableMap<String?, String?>?
    ) {
        if (!initDone) {
            ctxWay = expctxWay
            ctxNode = expctxNode
            wayIdxMaxspeed = ctxWay!!.getOutputVariableIndex("maxspeed", false)
            wayIdxMaxspeedExplicit = ctxWay!!.getOutputVariableIndex("maxspeed_explicit", false)
            wayIdxMinspeed = ctxWay!!.getOutputVariableIndex("minspeed", false)
            nodeIdxMaxspeed = ctxNode!!.getOutputVariableIndex("maxspeed", false)
            initDone = true
        }

        params = extraParams

        turnAngleDecayTime = getParam("turnAngleDecayTime", 5f).toDouble()
        f_roll = getParam("f_roll", 232f).toDouble()
        f_air = getParam("f_air", 0.4f).toDouble()
        f_recup = getParam("f_recup", 400f).toDouble()
        p_standby = getParam("p_standby", 250f).toDouble()
        outside_temp = getParam("outside_temp", 20f).toDouble()
        recup_efficiency = getParam("recup_efficiency", 0.7f).toDouble()
        totalweight = getParam("totalweight", 1640f).toDouble()
        vmax = getParam("vmax", 80f) / 3.6
        leftWaySpeed = getParam("leftWaySpeed", 12f) / 3.6
        rightWaySpeed = getParam("rightWaySpeed", 12f) / 3.6

        pw = 2.0 * f_air * vmax * vmax * vmax - p_standby
        cost0 = (pw + p_standby) / vmax + f_roll + f_air * vmax * vmax
    }

    protected fun getParam(name: String?, defaultValue: Float): Float {
        val sval = if (params == null) null else params!!.get(name)
        if (sval != null) {
            return sval.toFloat()
        }
        val v = ctxWay!!.getVariableValue(name, defaultValue)
        if (params != null) {
            params!!.put(name, "" + v)
        }
        return v
    }

    val wayMaxspeed: Float
        get() = ctxWay!!.getBuildInVariable(wayIdxMaxspeed) / 3.6f

    val wayMaxspeedExplicit: Float
        get() = ctxWay!!.getBuildInVariable(wayIdxMaxspeedExplicit) / 3.6f

    val wayMinspeed: Float
        get() = ctxWay!!.getBuildInVariable(wayIdxMinspeed) / 3.6f

    val nodeMaxspeed: Float
        get() = ctxNode!!.getBuildInVariable(nodeIdxMaxspeed) / 3.6f

    val effectiveSpeedLimit: Double
        /**
         * get the effective speed limit from the way-limit and vmax/vmin
         */
        get() {
            // performance related inline coding
            val minspeed = this.wayMinspeed.toDouble()
            val espeed = if (minspeed > vmax) minspeed else vmax
            val maxspeed = this.wayMaxspeed.toDouble()
            return if (maxspeed < espeed) maxspeed else espeed
        }

    /**
     * get the breaking speed for current balance-power (pw) and effective speed limit (vl)
     */
    fun getBreakingSpeed(vl: Double): Double {
        if (vl == lastEffectiveLimit) {
            return lastBreakingSpeed
        }

        var v = vl * 0.8
        val pw2 = pw + p_standby
        val e = recup_efficiency
        val x0 = pw2 / vl + f_air * e * vl * vl + (1.0 - e) * f_roll
        for (i in 0..4) {
            val v2 = v * v
            val x = pw2 / v + f_air * e * v2 - x0
            val dx = 2.0 * e * f_air * v - pw2 / v2
            v -= x / dx
        }
        lastEffectiveLimit = vl
        lastBreakingSpeed = v

        return v
    }
}
