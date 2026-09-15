package net.stho.tracks

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.toKString
import okio.FileSystem
import okio.Path.Companion.toPath

@OptIn(ExperimentalForeignApi::class)
internal actual fun environment(name: String): String? = platform.posix.getenv(name)?.toKString()

internal actual fun readText(path: String): String = FileSystem.SYSTEM.read(path.toPath()) { readUtf8() }
