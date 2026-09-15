package btools.util
import kotlin.jvm.JvmStatic

/**
 * Some methods for String handling
 */
object StringUtils {
    private val xmlChr = charArrayOf('&', '<', '>', '\'', '"', '\t', '\n', '\r')
    private val xmlEsc: Array<String> =
        arrayOf<String>("&amp;", "&lt;", "&gt;", "&apos;", "&quot;", "&#x9;", "&#xA;", "&#xD;")

    private val jsnChr = charArrayOf('\'', '"', '\\', '/')
    private val jsnEsc: Array<String> = arrayOf<String>("\\'", "\\\"", "\\\\", "\\/")

    /**
     * Escape a literal to put into a json document
     */
    @JvmStatic
    fun escapeJson(s: String): String {
        return escape(s, jsnChr, jsnEsc)
    }

    /**
     * Escape a literal to put into a xml document
     */
    @JvmStatic
    fun escapeXml10(s: String): String {
        return escape(s, xmlChr, xmlEsc)
    }

    private fun escape(s: String, chr: CharArray, esc: Array<String>): String {
        var sb: StringBuilder? = null
        for (i in 0..<s.length) {
            val c = s.get(i)
            var j = 0
            while (j < chr.size) {
                if (c == chr[j]) {
                    if (sb == null) {
                        sb = StringBuilder(s.substring(0, i))
                    }
                    sb.append(esc[j])
                    break
                }
                j++
            }
            if (sb != null && j == chr.size) {
                sb.append(c)
            }
        }
        return if (sb == null) s else sb.toString()
    }
}
