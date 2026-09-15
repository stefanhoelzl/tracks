package btools.kmp

@Suppress("NOTHING_TO_INLINE")
actual inline fun <R> synchronized(lock: Any, block: () -> R): R = kotlin.synchronized(lock, block)
