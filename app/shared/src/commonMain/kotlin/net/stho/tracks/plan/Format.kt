package net.stho.tracks.plan

import net.stho.tracks.codec.jsNumberToString
import net.stho.tracks.codec.jsRound
import net.stho.tracks.codec.jsToFixed
import kotlin.math.floor

/**
 * SI in, metric display out, from `packages/web/src/lib/format.ts`: a plan's numbers read on the phone exactly as they
 * read on the web beside it. Pinned by `format.json`.
 */
object Format {
    /** Thin spaces between thousands, whatever the platform's locale would have chosen. */
    private const val THIN_SPACE = " "
    private val THOUSANDS = Regex("""\B(?=(\d{3})+(?!\d))""")

    fun group(value: Double): String = THOUSANDS.replace(jsNumberToString(value), THIN_SPACE)

    fun km(metres: Double?, digits: Int = 1): String = metres?.let { jsToFixed(it / 1000, digits) } ?: "—"

    fun metres(value: Double?): String = value?.let { group(jsRound(it)) } ?: "—"

    /** `7:33` for hours, `48:20` below an hour — never `0:48:20`. */
    fun duration(seconds: Double?): String {
        if (seconds == null) return "—"
        val total = jsRound(seconds)
        val hours = floor(total / 3600)
        val minutes = floor((total % 3600) / 60)
        if (hours == 0.0) return "${jsNumberToString(minutes)}:${jsNumberToString(total % 60).padStart(2, '0')}"
        return "${jsNumberToString(hours)}:${jsNumberToString(minutes).padStart(2, '0')}"
    }
}
