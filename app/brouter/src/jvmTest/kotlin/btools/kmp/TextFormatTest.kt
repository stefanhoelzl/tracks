package btools.kmp

import java.io.File
import java.text.DecimalFormat
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals

/** Checks the hand-written formats against the JDK classes they replace. */
class TextFormatTest {
    private val jdk = (NumberFormat.getInstance(Locale.ENGLISH) as DecimalFormat).apply { applyPattern("0.###") }

    private fun check(f: Float) = assertEquals(jdk.format(f), TextFormat.decimal3(f), "value $f (bits ${f.toRawBits()})")

    @Test
    fun decimal3EdgeCases() {
        listOf(
            0f, -0f, 1f, 0.0625f, 0.1875f, 2.0625f, 1.0005f, 0.0005f, 0.0015f, 6.605f, 7.159f, 24.81f, 59.6f,
            0.9995f, 9.9995f, 99999.9f, 1e-7f, Float.MIN_VALUE, 123456.78f, 16777216f, 3.4e9f, -1.5f, -0.0004f,
        ).forEach(::check)
        for (k in 0 until 16 * 64) check(k / 16f + 3f) // every binary tie at the 4th decimal
    }

    @Test
    fun decimal3Random() {
        val rnd = Random(42)
        repeat(2_000_000) {
            val f = when (it % 3) {
                0 -> rnd.nextFloat() * 20_000f
                1 -> Float.fromBits(rnd.nextInt() and 0x7fffffff).let { v -> if (v.isFinite() && v < 1e9f) v else 1f }
                else -> (rnd.nextInt(0, 20_000_000) / 1000f)
            }
            check(f)
        }
    }

    @Test
    fun decimal3AllFixtureTimes() {
        val parity = java.lang.System.getenv("TRACKS_BROUTER_PARITY") ?: error("TRACKS_BROUTER_PARITY is not set — run the tests through Gradle")
        val dir = File(parity, "brouter.de")
        var n = 0
        dir.listFiles { f -> f.name.endsWith(".geojson") }!!.forEach { file ->
            val line = file.readLines().firstOrNull { it.contains("\"times\"") } ?: return@forEach
            line.substringAfter('[').substringBefore(']').split(',').forEach { s ->
                val f = s.trim().toFloat()
                assertEquals(s.trim(), TextFormat.decimal3(f), "fixture ${file.name} value $s")
                n++
            }
        }
        println("checked $n fixture times")
    }

    @Test
    fun isoUtc() {
        val jdkDate = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val rnd = Random(7)
        val samples = listOf(0L, 1L, 999L, 86_399_999L, 951_782_400_000L, 4_102_444_800_000L, 1_700_000_000_123L) +
            List(200_000) { rnd.nextLong(0, 8_000_000_000_000L) }
        for (ms in samples) assertEquals(jdkDate.format(Date(ms)), TextFormat.isoUtcMillis(ms), "ms $ms")
    }
}
