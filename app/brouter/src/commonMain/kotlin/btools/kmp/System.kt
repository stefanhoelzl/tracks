package btools.kmp

import kotlin.time.TimeSource

/**
 * The java.lang.System members BRouter's core calls. Converted files `import btools.kmp.System`; on the JVM
 * that explicit import shadows the implicit java.lang.System, so the call sites stay unchanged.
 */
object System {
    private val properties = HashMap<String, String>()
    private val start = TimeSource.Monotonic.markNow()
    private val epochAtStart: Long = Platform.currentTimeMillis()

    /** Epoch milliseconds (used for timeouts and log lines only). */
    fun currentTimeMillis(): Long = epochAtStart + start.elapsedNow().inWholeMilliseconds

    fun nanoTime(): Long = start.elapsedNow().inWholeNanoseconds

    /** java.lang.System.arraycopy; a null array throws NullPointerException as on the JVM. */
    fun arraycopy(src: Any?, srcPos: Int, dest: Any?, destPos: Int, length: Int) {
        if (src == null || dest == null) throw NullPointerException("arraycopy: null array")
        when (src) {
            is ByteArray -> src.copyInto(dest as ByteArray, destPos, srcPos, srcPos + length)
            is IntArray -> src.copyInto(dest as IntArray, destPos, srcPos, srcPos + length)
            is LongArray -> src.copyInto(dest as LongArray, destPos, srcPos, srcPos + length)
            is ShortArray -> src.copyInto(dest as ShortArray, destPos, srcPos, srcPos + length)
            is CharArray -> src.copyInto(dest as CharArray, destPos, srcPos, srcPos + length)
            is FloatArray -> src.copyInto(dest as FloatArray, destPos, srcPos, srcPos + length)
            is DoubleArray -> src.copyInto(dest as DoubleArray, destPos, srcPos, srcPos + length)
            is BooleanArray -> src.copyInto(dest as BooleanArray, destPos, srcPos, srcPos + length)
            is Array<*> -> {
                @Suppress("UNCHECKED_CAST")
                (src as Array<Any?>).copyInto(dest as Array<Any?>, destPos, srcPos, srcPos + length)
            }
            else -> throw IllegalArgumentException("arraycopy: not an array: $src")
        }
    }

    fun getProperty(key: String): String? = properties[key]
    fun getProperty(key: String, def: String): String = properties[key] ?: def
    fun setProperty(key: String, value: String): String? = properties.put(key, value)

    /** java.lang.Boolean.getBoolean: true iff the system property exists and equals "true" (ignoring case). */
    fun getBoolean(name: String): Boolean = properties[name].equals("true", ignoreCase = true)

    fun exit(status: Int): Nothing = throw IllegalStateException("System.exit($status) called")

    val out: PrintStream = PrintStream(false)
    val err: PrintStream = PrintStream(true)

    class PrintStream(private val isErr: Boolean) {
        fun println(x: Any?) = Platform.printLine(x.toString(), isErr)
        fun println() = Platform.printLine("", isErr)
        fun print(x: Any?) = Platform.printLine(x.toString(), isErr) // BRouter only prints whole lines
        fun flush() {}
    }
}

/** The two things common Kotlin cannot do on its own. */
expect object Platform {
    fun currentTimeMillis(): Long
    fun printLine(s: String, isErr: Boolean)
}
