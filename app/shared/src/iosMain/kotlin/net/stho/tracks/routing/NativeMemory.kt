package net.stho.tracks.routing

import kotlin.native.runtime.GC
import kotlin.native.runtime.NativeRuntimeApi

/** For measurements: settle the Kotlin heap between runs, so what is left is what a route keeps. */
object NativeMemory {
    @OptIn(NativeRuntimeApi::class)
    fun collect() = GC.collect()
}
