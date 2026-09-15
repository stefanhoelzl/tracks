package btools.kmp

/**
 * Hand-written replacements for the two java.text formats BRouter uses, reproducing the JDK's output
 * exactly (the GeoJSON is compared byte for byte against brouter.de).
 */
object TextFormat {
    /**
     * `new DecimalFormat("0.###")` in Locale.ENGLISH applied to a float (widened to double, as
     * `DecimalFormat.format(double)` sees it): at least one integer digit, up to three fraction digits,
     * no trailing zeros, no grouping, rounding HALF_EVEN on the exact binary value (JDK 8+ behaviour).
     */
    fun decimal3(value: Float): String {
        if (value.isNaN()) return "NaN" // DecimalFormatSymbols.getNaN() for ENGLISH
        if (value.isInfinite()) return if (value > 0) "∞" else "-∞"
        val bits = value.toRawBits()
        val negative = bits < 0
        val exp = (bits ushr 23) and 0xff
        val frac = bits and 0x7fffff
        // value = mant * 2^shift exactly
        val mant: Long
        val shift: Int
        if (exp == 0) {
            mant = frac.toLong(); shift = -149
        } else {
            mant = (frac or 0x800000).toLong(); shift = exp - 150
        }
        val thousandths: Long = if (shift >= 0) {
            // integral value (< 2^128 would overflow; floats this large never occur in a track)
            require(shift <= 30) { "decimal3: value out of range: $value" }
            (mant shl shift) * 1000
        } else {
            val scaled = mant * 1000 // < 2^34
            val s = -shift
            if (s >= 63) {
                0L // < 2^-38 thousandths
            } else {
                val q = scaled shr s
                val r = scaled - (q shl s)
                val half = 1L shl (s - 1)
                when {
                    r > half -> q + 1
                    r < half -> q
                    else -> if (q and 1L == 0L) q else q + 1
                }
            }
        }
        val sb = StringBuilder()
        // DecimalFormat keeps the sign bit, even for -0.0 and for negatives that round to zero ("-0").
        if (negative) sb.append('-')
        sb.append(thousandths / 1000)
        var f = (thousandths % 1000).toInt()
        if (f != 0) {
            var digits = 3
            while (f % 10 == 0) { f /= 10; digits-- }
            sb.append('.')
            val s = f.toString()
            repeat(digits - s.length) { sb.append('0') }
            sb.append(s)
        }
        return sb.toString()
    }

    /**
     * `String.format(Locale.US, "%3.1f", value)` for a float argument (widened to double, as Formatter sees
     * it): one fraction digit, RoundingMode.HALF_UP on the exact decimal value, left-padded with spaces to a
     * width of 3.
     */
    fun fixed1Width3(value: Float): String {
        if (value.isNaN()) return "NaN"
        if (value.isInfinite()) return if (value > 0) "Infinity" else "-Infinity"
        val bits = value.toRawBits()
        val negative = bits < 0
        val exp = (bits ushr 23) and 0xff
        val frac = bits and 0x7fffff
        val mant: Long
        val shift: Int
        if (exp == 0) {
            mant = frac.toLong(); shift = -149
        } else {
            mant = (frac or 0x800000).toLong(); shift = exp - 150
        }
        // tenths, rounded half up (away from zero on the magnitude, as HALF_UP does)
        val tenths: Long = if (shift >= 0) {
            require(shift <= 30) { "fixed1Width3: value out of range: $value" }
            (mant shl shift) * 10
        } else {
            val scaled = mant * 10
            val s = -shift
            if (s >= 63) 0L else {
                val q = scaled shr s
                val r = scaled - (q shl s)
                val half = 1L shl (s - 1)
                if (r >= half) q + 1 else q
            }
        }
        val body = "${tenths / 10}.${tenths % 10}"
        // Formatter prints "-0.0" for negative values that round to zero
        val s = if (negative) "-$body" else body
        return s.padStart(3, ' ')
    }

    /** `new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)` in UTC, for epoch milliseconds. */
    fun isoUtcMillis(epochMillis: Long): String {
        val days = floorDiv(epochMillis, 86_400_000L)
        val msOfDay = epochMillis - days * 86_400_000L
        // civil_from_days (H. Hinnant), proleptic Gregorian like SimpleDateFormat after 1582
        val z = days + 719_468
        val era = floorDiv(z, 146_097L)
        val doe = z - era * 146_097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        var y = yoe + era * 400
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = if (mp < 10) mp + 3 else mp - 9
        if (m <= 2) y += 1
        val h = msOfDay / 3_600_000
        val mi = (msOfDay / 60_000) % 60
        val s = (msOfDay / 1000) % 60
        val ms = msOfDay % 1000
        return "${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}.${pad(ms, 3)}Z"
    }

    private fun floorDiv(a: Long, b: Long): Long {
        val q = a / b
        return if ((a % b != 0L) && ((a < 0) != (b < 0))) q - 1 else q
    }

    private fun pad(v: Long, width: Int): String = v.toString().padStart(width, '0')
}
