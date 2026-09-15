package net.stho.tracks.codec

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow

/** A `[lat, lon]` pair, in the order the polyline algorithm keeps them. */
data class Coordinate(val lat: Double, val lon: Double)

/**
 * Google's polyline algorithm, as `@mapbox/polyline` 1.2.1 implements it.
 *
 * That package is the reference rather than the algorithm's description, because the web
 * encodes with it and the phone has to produce the same characters — a plan link, a track,
 * an import frame. So this is a port of the JavaScript, not of the idea: the arithmetic
 * stays in doubles and the bitwise operators go through [toInt32]. The edges are where that
 * shows: halves round away from zero (Python 2's rule, which the package copies), and a
 * truncated string decodes to something instead of throwing.
 *
 * The default precision is 5, as in the package. The plan fragment uses it; tracks and
 * import frames pass [TRACK_PRECISION].
 */
object Polyline {
    fun encode(coordinates: List<Coordinate>, precision: Int = 5): String {
        if (coordinates.isEmpty()) return ""
        val factor = factor(precision)
        val out = StringBuilder()
        encodeValue(coordinates[0].lat, 0.0, factor, out)
        encodeValue(coordinates[0].lon, 0.0, factor, out)
        for (i in 1 until coordinates.size) {
            val current = coordinates[i]
            val previous = coordinates[i - 1]
            encodeValue(current.lat, previous.lat, factor, out)
            encodeValue(current.lon, previous.lon, factor, out)
        }
        return out.toString()
    }

    fun decode(encoded: String, precision: Int = 5): List<Coordinate> {
        val factor = factor(precision)
        val coordinates = ArrayList<Coordinate>()
        var index = 0
        var lat = 0.0
        var lon = 0.0

        while (index < encoded.length) {
            var shift = 1.0
            var result = 0.0
            var byte: Double
            do {
                byte = charCodeAt(encoded, index++) - 63
                result += (toInt32(byte) and 0x1f) * shift
                shift *= 32
            } while (byte >= 0x20)
            val latChange = if ((toInt32(result) and 1) != 0) (-result - 1) / 2 else result / 2

            shift = 1.0
            result = 0.0
            do {
                byte = charCodeAt(encoded, index++) - 63
                result += (toInt32(byte) and 0x1f) * shift
                shift *= 32
            } while (byte >= 0x20)
            val lonChange = if ((toInt32(result) and 1) != 0) (-result - 1) / 2 else result / 2

            lat += latChange
            lon += lonChange
            coordinates.add(Coordinate(lat / factor, lon / factor))
        }

        return coordinates
    }

    private fun encodeValue(current: Double, previous: Double, factor: Double, out: StringBuilder) {
        var coordinate = (py2Round(current * factor) - py2Round(previous * factor)) * 2
        if (coordinate < 0) coordinate = -coordinate - 1
        while (coordinate >= 0x20) {
            out.append(fromCharCode(((0x20 or (toInt32(coordinate) and 0x1f)) + 63).toDouble()))
            coordinate /= 32
        }
        out.append(fromCharCode((toInt32(coordinate) + 63).toDouble()))
    }

    private fun py2Round(value: Double): Double = floor(abs(value) + 0.5) * (if (value >= 0) 1.0 else -1.0)

    /** `Math.pow(10, precision)`, exact: repeated multiplication stays exact up to 10^22. */
    private fun factor(precision: Int): Double {
        if (precision !in 0..22) return 10.0.pow(precision)
        var factor = 1.0
        repeat(precision) { factor *= 10 }
        return factor
    }
}
