package btools.kmp

/**
 * `synchronized(lock) { ... }` for common code. On the JVM it is the real monitor (kotlin.synchronized). On
 * Native it only runs the block: BRouter's engine locks its open set so another thread can read progress
 * (getOpenSet / pathPeak) while a route runs; the app routes on one thread and does not read those, so no lock
 * is taken. A caller that starts reading engine state from another thread on Native needs a real lock here.
 */
expect inline fun <R> synchronized(lock: Any, block: () -> R): R
