package net.stho.tracks

import java.io.File

internal actual fun environment(name: String): String? = System.getenv(name)

internal actual fun readText(path: String): String = File(path).readText()
