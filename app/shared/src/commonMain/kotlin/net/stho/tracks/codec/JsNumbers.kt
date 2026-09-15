package net.stho.tracks.codec

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.truncate

/*
 * What JavaScript does to a Number, for the ports that have to agree with it character for
 * character. The TypeScript is the reference, so where it computes in doubles and runs
 * bitwise operators on them, the Kotlin does too, rather than choosing an integer type
 * that agrees with it everywhere except at the edges.
 */

/** ECMAScript ToInt32: what `|`, `&`, `<<` and `>>` do to their operands first. */
internal fun toInt32(value: Double): Int {
    if (!value.isFinite()) return 0
    return (truncate(value) % 4_294_967_296.0).toLong().toInt()
}

/** `String.fromCharCode`, which takes its argument modulo 2^16. */
internal fun fromCharCode(code: Double): Char = (toInt32(code) and 0xFFFF).toChar()

/** `String.prototype.charCodeAt`, which is NaN past the end rather than an error. */
internal fun charCodeAt(text: String, index: Int): Double =
    if (index in text.indices) text[index].code.toDouble() else Double.NaN

/** What `String.prototype.trim` and `Number(string)` strip: ECMAScript's WhiteSpace and LineTerminator. */
internal fun isJsWhitespace(c: Char): Boolean = when (c) {
    '\t', '', '', ' ', ' ', '﻿', '\n', '\r', ' ', ' ' -> true
    else -> c.category == CharCategory.SPACE_SEPARATOR
}

/** `String.prototype.trim`. Kotlin's own also strips U+001C–U+001F, and keeps U+FEFF. */
internal fun jsTrim(text: String): String = text.trim(::isJsWhitespace)

/**
 * `String(number)`: the shortest digits that read back as the same double, laid out by ECMAScript's
 * Number::toString — plain up to 21 integer digits, `0.000001` but `1e-7`.
 */
internal fun jsNumberToString(value: Double): String {
    if (value.isNaN()) return "NaN"
    if (value == 0.0) return "0"
    if (value < 0) return "-" + jsNumberToString(-value)
    if (value.isInfinite()) return "Infinity"

    val (digits, n) = shortestDigits(value)
    val k = digits.length
    return when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val exponent = n - 1
            val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
            "${mantissa}e${if (exponent < 0) "-" else "+"}${abs(exponent)}"
        }
    }
}

/** For a positive finite [value]: its shortest round-trip digits, and n such that value = 0.digits × 10^n. */
private fun shortestDigits(value: Double): Pair<String, Int> {
    // Kotlin's toString round-trips, but is not always shortest — the JDK's never writes fewer than two digits, so
    // the smallest subnormal comes out as 4.9E-324 where JavaScript says 5e-324. Read its digits, then shorten them.
    val text = value.toString()
    val e = text.indexOfFirst { it == 'E' || it == 'e' }
    val mantissa = if (e < 0) text else text.substring(0, e)
    val exponent = if (e < 0) 0 else text.substring(e + 1).toInt()
    val point = mantissa.indexOf('.')
    val whole = if (point < 0) mantissa else mantissa.substring(0, point)
    val fraction = if (point < 0) "" else mantissa.substring(point + 1)

    val all = whole + fraction
    val leading = all.indexOfFirst { it != '0' }
    var digits = all.substring(leading).trimEnd('0')
    var n = whole.length + exponent - leading

    // One digit fewer, rounded the nearer way first, for as long as that still reads back as the same double.
    while (digits.length > 1) {
        val last = digits.last() - '0'
        val down = digits.dropLast(1).trimEnd('0') to n
        val up = increment(digits.dropLast(1), n)
        val shorter = (if (last >= 5) listOf(up, down) else listOf(down, up))
            .firstOrNull { (d, m) -> "0.${d}E$m".toDoubleOrNull() == value }
            ?: break
        digits = shorter.first
        n = shorter.second
    }
    return digits to n
}

/** 0.[digits] × 10^[n], plus one in its last digit. */
private fun increment(digits: String, n: Int): Pair<String, Int> {
    val chars = digits.toCharArray()
    var i = chars.size - 1
    while (i >= 0 && chars[i] == '9') {
        chars[i] = '0'
        i--
    }
    if (i < 0) return ("1" + chars.concatToString()).trimEnd('0').ifEmpty { "1" } to n + 1
    chars[i] = chars[i] + 1
    return chars.concatToString().trimEnd('0') to n
}

/**
 * `Number.prototype.toFixed`, for values whose scaled magnitude fits a Long. The specification rounds the double's
 * exact value, half up — and 11.00005 is really 11.0000499999…, so it gives 11.0000. That decision is taken here in
 * exact integer arithmetic, since no comparison in doubles can see it.
 */
internal fun jsToFixed(value: Double, digits: Int): String {
    if (value.isNaN()) return "NaN"
    if (abs(value) >= 1e21) return jsNumberToString(value)
    if (value < 0) return "-" + jsToFixed(-value, digits)

    var scale = 1L
    repeat(digits) { scale *= 10 }

    // value = m × 2^e exactly.
    val bits = value.toRawBits()
    val biased = ((bits ushr 52) and 0x7FF).toInt()
    val fraction = bits and ((1L shl 52) - 1)
    val m = if (biased == 0) fraction else fraction or (1L shl 52)
    val e = if (biased == 0) -1074 else biased - 1075

    val n = if (e >= 0) {
        (m shl e) * scale
    } else {
        // n = floor(value × 10^digits + 1/2): the largest n with (2n - 1) × 2^-e ≤ 2 × m × 10^digits.
        val twice = Nat.of(m).times(scale).times(2)
        var candidate = floor(value * scale.toDouble()).toLong()
        fun fits(c: Long) = c <= 0 || Nat.of(2 * c - 1).shl(-e) <= twice
        while (!fits(candidate)) candidate--
        while (fits(candidate + 1)) candidate++
        candidate
    }

    val text = n.toString().padStart(digits + 1, '0')
    return if (digits == 0) text else text.dropLast(digits) + "." + text.takeLast(digits)
}

/** Just enough of an unsigned big integer for [jsToFixed]: little-endian 32-bit limbs. */
private class Nat private constructor(private val limbs: LongArray) : Comparable<Nat> {
    fun times(factor: Long): Nat {
        require(factor in 0..0xFFFFFFFFL)
        val out = LongArray(limbs.size + 1)
        var carry = 0L
        for (i in limbs.indices) {
            val product = limbs[i] * factor + carry
            out[i] = product and MASK
            carry = product ushr 32
        }
        out[limbs.size] = carry
        return Nat(out)
    }

    fun shl(bits: Int): Nat {
        val whole = bits / 32
        val part = bits % 32
        val out = LongArray(limbs.size + whole + 1)
        for (i in limbs.indices) {
            val shifted = limbs[i] shl part
            out[i + whole] = out[i + whole] or (shifted and MASK)
            out[i + whole + 1] = shifted ushr 32
        }
        return Nat(out)
    }

    override fun compareTo(other: Nat): Int {
        for (i in maxOf(limbs.size, other.limbs.size) - 1 downTo 0) {
            val a = limbs.getOrElse(i) { 0L }
            val b = other.limbs.getOrElse(i) { 0L }
            if (a != b) return a.compareTo(b)
        }
        return 0
    }

    companion object {
        private const val MASK = 0xFFFFFFFFL

        fun of(value: Long): Nat {
            require(value >= 0)
            return Nat(longArrayOf(value and MASK, value ushr 32))
        }
    }
}

private val DECIMAL = Regex("[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?")

/** `Number(string)`: trimmed, empty is 0, `0x`/`0o`/`0b` prefixes, and NaN for anything else it does not read. */
internal fun jsStringToNumber(text: String): Double {
    val s = jsTrim(text)
    when (s) {
        "" -> return 0.0
        "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
        "-Infinity" -> return Double.NEGATIVE_INFINITY
    }

    if (s.length > 2 && s[0] == '0') {
        val radix = when (s[1]) {
            'x', 'X' -> 16
            'o', 'O' -> 8
            'b', 'B' -> 2
            else -> 0
        }
        if (radix != 0) {
            var number = 0.0
            for (c in s.substring(2)) {
                val digit = when (c) {
                    in '0'..'9' -> c - '0'
                    in 'a'..'f' -> c - 'a' + 10
                    in 'A'..'F' -> c - 'A' + 10
                    else -> return Double.NaN
                }
                if (digit >= radix) return Double.NaN
                number = number * radix + digit
            }
            return number
        }
    }

    if (!DECIMAL.matches(s)) return Double.NaN
    // `5.` and `.5` are numbers to JavaScript; spell them out before any platform's parser sees them.
    val e = s.indexOfFirst { it == 'e' || it == 'E' }
    val mantissa = if (e < 0) s else s.substring(0, e)
    val exponent = if (e < 0) "" else s.substring(e)
    val sign = if (mantissa[0] == '+' || mantissa[0] == '-') mantissa.substring(0, 1) else ""
    var body = mantissa.substring(sign.length)
    if (body.startsWith('.')) body = "0$body"
    if (body.endsWith('.')) body += "0"
    return "$sign$body$exponent".toDoubleOrNull() ?: Double.NaN
}

/** `Math.round`: halves go towards positive infinity, not away from zero and not to even. */
internal fun jsRound(value: Double): Double {
    if (value.isNaN()) return value
    val down = floor(value)
    return if (value - down >= 0.5) down + 1 else down
}
