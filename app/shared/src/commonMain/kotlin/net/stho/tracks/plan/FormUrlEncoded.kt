package net.stho.tracks.plan

/**
 * `URLSearchParams`, the half of it the plan fragment uses: the WHATWG
 * `application/x-www-form-urlencoded` parser and serializer.
 *
 * The web leaves escaping to the platform, so the platform's rules are the grammar — a space
 * is `+`, only `*-._` and alphanumerics go through bare, a malformed `%` stays literal, and
 * bytes that are not UTF-8 decode to U+FFFD. Any URL decoder that differs on one of those
 * would turn someone's POI name into a different string on the phone.
 */
internal object FormUrlEncoded {
    fun serialize(pairs: List<Pair<String, String>>): String =
        pairs.joinToString("&") { (name, value) -> encode(name) + "=" + encode(value) }

    /** As `new URLSearchParams(input)`: a leading `?` is dropped first. */
    fun parse(input: String): List<Pair<String, String>> {
        val bytes = utf8Encode(if (input.startsWith("?")) input.substring(1) else input)
        val pairs = ArrayList<Pair<String, String>>()
        var start = 0
        while (start <= bytes.size) {
            var end = start
            while (end < bytes.size && bytes[end] != '&'.code.toByte()) end++
            if (end > start) {
                var equals = start
                while (equals < end && bytes[equals] != '='.code.toByte()) equals++
                val name = decode(bytes, start, equals)
                val value = if (equals < end) decode(bytes, equals + 1, end) else ""
                pairs.add(name to value)
            }
            start = end + 1
        }
        return pairs
    }

    private fun encode(text: String): String {
        val out = StringBuilder()
        for (byte in utf8Encode(text)) {
            val b = byte.toInt() and 0xFF
            when {
                b == 0x20 -> out.append('+')
                b == 0x2A || b == 0x2D || b == 0x2E || b == 0x5F ||
                    b in 0x30..0x39 || b in 0x41..0x5A || b in 0x61..0x7A -> out.append(b.toChar())
                else -> out.append('%').append(HEX[b shr 4]).append(HEX[b and 0xF])
            }
        }
        return out.toString()
    }

    private fun decode(bytes: ByteArray, from: Int, to: Int): String {
        val out = ByteArray(to - from)
        var length = 0
        var i = from
        while (i < to) {
            val b = bytes[i].toInt() and 0xFF
            if (b == '+'.code) {
                out[length++] = 0x20
            } else if (b == '%'.code && i + 2 < to && hex(bytes[i + 1]) >= 0 && hex(bytes[i + 2]) >= 0) {
                out[length++] = (hex(bytes[i + 1]) * 16 + hex(bytes[i + 2])).toByte()
                i += 2
            } else {
                out[length++] = bytes[i]
            }
            i++
        }
        return utf8Decode(out, length)
    }

    private fun hex(byte: Byte): Int = when (val c = byte.toInt()) {
        in '0'.code..'9'.code -> c - '0'.code
        in 'A'.code..'F'.code -> c - 'A'.code + 10
        in 'a'.code..'f'.code -> c - 'a'.code + 10
        else -> -1
    }

    private const val HEX = "0123456789ABCDEF"
}

/**
 * UTF-8, from a JavaScript string: a lone surrogate becomes U+FFFD, as the conversion to a
 * USVString does. Not `encodeToByteArray`, which does not promise that on every platform.
 */
internal fun utf8Encode(text: String): ByteArray {
    val out = ArrayList<Byte>(text.length)
    var i = 0
    while (i < text.length) {
        val c = text[i]
        var codePoint = c.code
        if (c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate()) {
            codePoint = 0x10000 + ((c.code - 0xD800) shl 10) + (text[i + 1].code - 0xDC00)
            i++
        } else if (c.isSurrogate()) {
            codePoint = 0xFFFD
        }
        when {
            codePoint < 0x80 -> out.add(codePoint.toByte())
            codePoint < 0x800 -> {
                out.add((0xC0 or (codePoint shr 6)).toByte())
                out.add((0x80 or (codePoint and 0x3F)).toByte())
            }
            codePoint < 0x10000 -> {
                out.add((0xE0 or (codePoint shr 12)).toByte())
                out.add((0x80 or ((codePoint shr 6) and 0x3F)).toByte())
                out.add((0x80 or (codePoint and 0x3F)).toByte())
            }
            else -> {
                out.add((0xF0 or (codePoint shr 18)).toByte())
                out.add((0x80 or ((codePoint shr 12) and 0x3F)).toByte())
                out.add((0x80 or ((codePoint shr 6) and 0x3F)).toByte())
                out.add((0x80 or (codePoint and 0x3F)).toByte())
            }
        }
        i++
    }
    return out.toByteArray()
}

/**
 * The WHATWG UTF-8 decoder, with replacement and without BOM handling — the one the form
 * parser specifies. Written out because how many U+FFFD a malformed run becomes is part of
 * the spec, and platform decoders disagree about it.
 */
internal fun utf8Decode(bytes: ByteArray, length: Int = bytes.size): String {
    val out = StringBuilder(length)
    var needed = 0
    var seen = 0
    var codePoint = 0
    var lower = 0x80
    var upper = 0xBF
    var i = 0

    while (i < length) {
        val b = bytes[i].toInt() and 0xFF
        if (needed == 0) {
            when (b) {
                in 0x00..0x7F -> out.append(b.toChar())
                in 0xC2..0xDF -> { needed = 1; codePoint = b and 0x1F }
                in 0xE0..0xEF -> {
                    if (b == 0xE0) lower = 0xA0
                    if (b == 0xED) upper = 0x9F
                    needed = 2
                    codePoint = b and 0xF
                }
                in 0xF0..0xF4 -> {
                    if (b == 0xF0) lower = 0x90
                    if (b == 0xF4) upper = 0x8F
                    needed = 3
                    codePoint = b and 0x7
                }
                else -> out.append('�')
            }
            i++
            continue
        }
        if (b !in lower..upper) {
            // Reset and reprocess this byte as the start of the next sequence.
            codePoint = 0
            needed = 0
            seen = 0
            lower = 0x80
            upper = 0xBF
            out.append('�')
            continue
        }
        lower = 0x80
        upper = 0xBF
        codePoint = (codePoint shl 6) or (b and 0x3F)
        seen++
        i++
        if (seen == needed) {
            appendCodePoint(out, codePoint)
            codePoint = 0
            needed = 0
            seen = 0
        }
    }
    if (needed != 0) out.append('�')
    return out.toString()
}

private fun appendCodePoint(out: StringBuilder, codePoint: Int) {
    if (codePoint < 0x10000) {
        out.append(codePoint.toChar())
    } else {
        val offset = codePoint - 0x10000
        out.append((0xD800 + (offset shr 10)).toChar())
        out.append((0xDC00 + (offset and 0x3FF)).toChar())
    }
}
