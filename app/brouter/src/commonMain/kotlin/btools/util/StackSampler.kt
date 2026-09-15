package btools.util

import btools.kmp.io.File

/**
 * Debug tooling: the JVM version is a thread that periodically dumps all thread stacks to a log file, started
 * only when a `stacks.txt` exists next to the profiles. Thread dumps do not exist in common Kotlin; this keeps
 * the API RoutingEngine uses and does nothing.
 */
class StackSampler(@Suppress("UNUSED_PARAMETER") logfile: File, @Suppress("UNUSED_PARAMETER") interval: Int) {
    fun start() {}
    fun close() {}
}
