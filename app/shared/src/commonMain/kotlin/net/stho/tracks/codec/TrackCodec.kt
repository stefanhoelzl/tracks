package net.stho.tracks.codec

/** What full-resolution geometry is encoded at, everywhere: tracks and import frames. */
const val TRACK_PRECISION = 6

/** Altitude is stored and sent in decimetres. */
const val ALTITUDE_SCALE = 10

/**
 * The scalar codec from `packages/core/src/track-codec.ts`: the polyline scheme in one
 * dimension, with `null` surviving the round trip as an odd chunk.
 *
 * Ported operator for operator, including the 32-bit wrap of JavaScript's `<<` and `>>`,
 * so a value outside ±2^29 encodes to the same characters the web would produce rather than
 * to different ones. Nobody should be sending such a value: altitude is decimetres and time
 * is seconds from the start.
 */
object TrackCodec {
    private const val ABSENT = 1

    fun encodeScalars(values: List<Long?>): String {
        val out = StringBuilder()
        var previous = 0.0

        for (value in values) {
            if (value == null) {
                chunk(ABSENT.toDouble(), out)
                continue
            }
            val current = value.toDouble()
            val delta = current - previous
            previous = current
            val doubled = toInt32(delta) shl 1
            chunk((if (delta < 0) doubled.inv() else doubled).toDouble() * 2, out)
        }

        return out.toString()
    }

    /** The inverse. Throws on a truncated stream rather than returning a short list. */
    fun decodeScalars(encoded: String): List<Long?> {
        val values = ArrayList<Long?>()
        var previous = 0.0
        var index = 0

        while (index < encoded.length) {
            var result = 0
            var shift = 0
            var byte: Int

            do {
                if (index >= encoded.length) throw IllegalArgumentException("scalar stream ends mid-value")
                byte = encoded[index++].code - 63
                if (byte < 0) throw IllegalArgumentException("scalar stream holds a character outside the alphabet")
                result = result or ((byte and 0x1f) shl shift)
                shift += 5
            } while (byte >= 0x20)

            if ((result and 1) == ABSENT) {
                values.add(null)
                continue
            }

            val zigzag = result shr 1
            previous += if ((zigzag and 1) != 0) (zigzag shr 1).inv() else zigzag shr 1
            values.add(previous.toLong())
        }

        return values
    }

    /** Metres, from decimetres, with `null` preserved. */
    fun altitudesFromScalars(values: List<Long?>): List<Double?> =
        values.map { value -> value?.let { it.toDouble() / ALTITUDE_SCALE } }

    /** Decimetres, from metres, with `null` preserved — rounded as `Math.round` rounds. */
    fun altitudesToScalars(values: List<Double?>): List<Long?> =
        values.map { value -> value?.let { jsRound(it * ALTITUDE_SCALE).toLong() } }

    private fun chunk(value: Double, out: StringBuilder) {
        var rest = value
        while (rest >= 0x20) {
            out.append(fromCharCode(((0x20 or (toInt32(rest) and 0x1f)) + 63).toDouble()))
            rest = (toInt32(rest) shr 5).toDouble()
        }
        out.append(fromCharCode(rest + 63))
    }
}
