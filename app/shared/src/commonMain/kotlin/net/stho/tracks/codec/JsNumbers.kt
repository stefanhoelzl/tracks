package net.stho.tracks.codec

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

/** `Math.round`: halves go towards positive infinity, not away from zero and not to even. */
internal fun jsRound(value: Double): Double {
    if (value.isNaN()) return value
    val down = floor(value)
    return if (value - down >= 0.5) down + 1 else down
}
