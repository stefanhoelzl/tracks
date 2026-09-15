package net.stho.tracks.brouter

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.toKString

@OptIn(ExperimentalForeignApi::class)
internal actual fun environment(name: String): String? = platform.posix.getenv(name)?.toKString()
