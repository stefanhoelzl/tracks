package btools.kmp

import kotlinx.cinterop.ExperimentalForeignApi
import platform.posix.fflush
import platform.posix.fputs
import platform.posix.stderr
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

actual object Platform {
    @OptIn(ExperimentalTime::class)
    actual fun currentTimeMillis(): Long = Clock.System.now().toEpochMilliseconds()

    @OptIn(ExperimentalForeignApi::class)
    actual fun printLine(s: String, isErr: Boolean) {
        if (isErr) {
            fputs(s + "\n", stderr)
            fflush(stderr)
        } else {
            println(s)
        }
    }
}
