package btools.expressions

import btools.util.LruMapNode
import kotlin.jvm.JvmField

class VarWrapper : LruMapNode() {
    @JvmField
    var vars: FloatArray? = null

    override fun hashCode(): Int {
        return hash
    }

    override fun equals(o: Any?): Boolean {
        val n = o as VarWrapper
        if (hash != n.hash) {
            return false
        }
        return vars.contentEquals(n.vars)
    }
}
