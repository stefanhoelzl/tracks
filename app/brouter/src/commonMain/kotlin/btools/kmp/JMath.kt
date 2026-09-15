package btools.kmp

import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** java.lang.Math / Double / Character statics with the JDK's exact semantics, for common Kotlin. */
object JMath {
    private const val RADIANS_TO_DEGREES = 57.29577951308232
    private const val DEGREES_TO_RADIANS = 0.017453292519943295

    fun toDegrees(angrad: Double): Double = angrad * RADIANS_TO_DEGREES
    fun toRadians(angdeg: Double): Double = angdeg * DEGREES_TO_RADIANS

    /** Math.round(float): floor(x + 0.5) as int, NaN -> 0, saturating. Kotlin's roundToInt has the same tie rule. */
    fun round(a: Float): Int = if (a.isNaN()) 0 else a.roundToInt()

    /** Math.round(double): floor(x + 0.5) as long, NaN -> 0, saturating. */
    fun round(a: Double): Long = if (a.isNaN()) 0L else a.roundToLong()

    fun isNaN(v: Double): Boolean = v.isNaN()
    fun isNaN(v: Float): Boolean = v.isNaN()

    /** Double.compare: -0.0 < 0.0, NaN greater than everything and equal to itself. */
    fun compare(a: Double, b: Double): Int = a.compareTo(b)

    fun isWhitespace(c: Char): Boolean = c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '' ||
        c == '' || c == '' || c == '' || c == '' || c == '' ||
        (c.isWhitespace() && c != ' ' && c != ' ' && c != ' ')
}
