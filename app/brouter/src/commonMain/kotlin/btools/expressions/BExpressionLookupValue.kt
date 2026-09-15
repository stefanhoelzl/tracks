/**
 * A lookup value with optional aliases
 * 
 * 
 * toString just gives the primary value,
 * equals just compares against primary value
 * matches() also compares aliases
 * 
 * @author ab
 */
package btools.expressions

class BExpressionLookupValue(var value: String) {
    var aliases: MutableList<String>? = null

    override fun toString(): String {
        return value
    }

    fun addAlias(alias: String?) {
        if (aliases == null) aliases = ArrayList<String>()
        aliases!!.add(alias!!)
    }

    override fun equals(o: Any?): Boolean {
        if (o is String) {
            val v = o
            return value == v
        }
        if (o is BExpressionLookupValue) {
            val v = o

            return value == v.value
        }
        return false
    }

    fun matches(s: String?): Boolean {
        if (value == s) return true
        if (aliases != null) {
            for (alias in aliases) {
                if (alias == s) return true
            }
        }
        return false
    }
}
