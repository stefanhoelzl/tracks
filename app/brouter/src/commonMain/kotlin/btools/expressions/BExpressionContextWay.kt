// context for simple expression
// context means:
// - the local variables
// - the local variable names
// - the lookup-input variables
package btools.expressions

import btools.codec.TagValueValidator

class BExpressionContextWay : BExpressionContext, TagValueValidator {
    override val buildInVariableNames: Array<String?>
        get() = Companion.buildInVariableNames

    private var decodeForbidden = true

    val costfactor: Float
        get() = getBuildInVariable(0)

    val turncost: Float
        get() = getBuildInVariable(1)

    val uphillCostfactor: Float
        get() = getBuildInVariable(2)

    val downhillCostfactor: Float
        get() = getBuildInVariable(3)

    val initialcost: Float
        get() = getBuildInVariable(4)

    val nodeAccessGranted: Float
        get() = getBuildInVariable(5)

    val initialClassifier: Float
        get() = getBuildInVariable(6)

    val trafficSourceDensity: Float
        get() = getBuildInVariable(7)

    val isTrafficBackbone: Float
        get() = getBuildInVariable(8)

    val priorityClassifier: Float
        get() = getBuildInVariable(9)

    val classifierMask: Float
        get() = getBuildInVariable(10)

    val maxspeed: Float
        get() = getBuildInVariable(11)

    val uphillcost: Float
        get() = getBuildInVariable(12)

    val downhillcost: Float
        get() = getBuildInVariable(13)

    val uphillcutoff: Float
        get() = getBuildInVariable(14)

    val downhillcutoff: Float
        get() = getBuildInVariable(15)

    val uphillmaxslope: Float
        get() = getBuildInVariable(16)

    val downhillmaxslope: Float
        get() = getBuildInVariable(17)

    val uphillmaxslopecost: Float
        get() = getBuildInVariable(18)

    val downhillmaxslopecost: Float
        get() = getBuildInVariable(19)

    constructor(meta: BExpressionMetaData?) : super("way", meta)

    /**
     * Create an Expression-Context for way context
     * 
     * @param hashSize size of hashmap for result caching
     */
    constructor(hashSize: Int, meta: BExpressionMetaData?) : super("way", hashSize, meta)

    override fun accessType(description: ByteArray): Int {
        evaluate(false, description)
        var minCostFactor = this.costfactor
        if (minCostFactor >= 9999f) {
            setInverseVars()
            val reverseCostFactor = this.costfactor
            if (reverseCostFactor < minCostFactor) {
                minCostFactor = reverseCostFactor
            }
        }
        return if (minCostFactor < 9999f) 2 else if (decodeForbidden) (if (minCostFactor < 10000f) 1 else 0) else 0
    }

    override fun setDecodeForbidden(decodeForbidden: Boolean) {
        this.decodeForbidden = decodeForbidden
    }


    companion object {
        protected val buildInVariableNames: Array<String?> = arrayOf<String?>(
            "costfactor",
            "turncost",
            "uphillcostfactor",
            "downhillcostfactor",
            "initialcost",
            "nodeaccessgranted",
            "initialclassifier",
            "trafficsourcedensity",
            "istrafficbackbone",
            "priorityclassifier",
            "classifiermask",
            "maxspeed",
            "uphillcost",
            "downhillcost",
            "uphillcutoff",
            "downhillcutoff",
            "uphillmaxslope",
            "downhillmaxslope",
            "uphillmaxslopecost",
            "downhillmaxslopecost"
        )
    }
}
