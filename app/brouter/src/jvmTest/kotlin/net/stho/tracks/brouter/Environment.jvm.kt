package net.stho.tracks.brouter

internal actual fun environment(name: String): String? = System.getenv(name)
