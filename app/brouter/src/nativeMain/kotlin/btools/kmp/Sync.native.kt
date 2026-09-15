package btools.kmp

@Suppress("NOTHING_TO_INLINE", "UNUSED_PARAMETER")
actual inline fun <R> synchronized(lock: Any, block: () -> R): R = block()
