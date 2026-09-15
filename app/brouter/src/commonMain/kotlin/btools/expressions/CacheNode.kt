package btools.expressions

import btools.util.LruMapNode
import kotlin.jvm.JvmField

class CacheNode : LruMapNode() {
    @JvmField
    var ab: ByteArray? = null
    @JvmField
    var vars: FloatArray? = null

    override fun hashCode(): Int {
        return hash
    }

    override fun equals(o: Any?): Boolean {
        val n = o as CacheNode
        if (hash != n.hash) {
            return false
        }
        if (ab == null) {
            return true // hack: null = crc match only
        }
        return ab.contentEquals(n.ab)
    }
}
