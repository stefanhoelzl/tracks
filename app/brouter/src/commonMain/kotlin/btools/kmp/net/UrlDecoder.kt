package btools.kmp.net

/**
 * java.net.URLDecoder.decode(s, "UTF-8"): '+' becomes a space, runs of %xx escapes are decoded as UTF-8 bytes
 * (malformed sequences become U+FFFD, as String(bytes, UTF_8) does), and an incomplete or non-hex escape
 * throws IllegalArgumentException.
 */
object URLDecoder {
    fun decode(s: String, @Suppress("UNUSED_PARAMETER") enc: String = "UTF-8"): String {
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when (c) {
                '+' -> { sb.append(' '); i++ }
                '%' -> {
                    val bytes = ArrayList<Byte>()
                    while (i < s.length && s[i] == '%') {
                        if (i + 2 >= s.length) throw IllegalArgumentException("URLDecoder: Incomplete trailing escape (%) pattern")
                        // Both characters must be hex digits. Up to JDK 21 the JDK parsed them with
                        // Integer.parseInt(.., 16), so a leading '+' passed as a sign; JDK 25 rejects it.
                        val hi = hex(s[i + 1])
                        val lo = hex(s[i + 2])
                        val v = if (hi < 0 || lo < 0) -1 else (hi shl 4) or lo
                        if (v < 0) throw IllegalArgumentException("URLDecoder: Illegal hex characters in escape (%) pattern")
                        bytes.add(v.toByte())
                        i += 3
                    }
                    sb.append(bytes.toByteArray().decodeToString())
                }
                else -> { sb.append(c); i++ }
            }
        }
        return sb.toString()
    }

    private fun hex(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> -1
    }
}
