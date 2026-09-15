// context for simple expression
// context means:
// - the local variables
// - the local variable names
// - the lookup-input variables
package btools.expressions


class BExpressionContextNode : BExpressionContext {
    override val buildInVariableNames: Array<String?>
        get() = Companion.buildInVariableNames

    val initialcost: Float
        get() = getBuildInVariable(0)


    constructor(meta: BExpressionMetaData?) : super("node", meta)

    /**
     * Create an Expression-Context for way context
     * 
     * @param hashSize size of hashmap for result caching
     */
    constructor(hashSize: Int, meta: BExpressionMetaData?) : super("node", hashSize, meta)

    companion object {
        protected val buildInVariableNames: Array<String?> = arrayOf<String?>("initialcost")
    }
}
