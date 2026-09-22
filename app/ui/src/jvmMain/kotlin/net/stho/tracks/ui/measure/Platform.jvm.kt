package net.stho.tracks.ui.measure

import com.sun.management.OperatingSystemMXBean
import java.lang.management.ManagementFactory

private val os = ManagementFactory.getOperatingSystemMXBean() as OperatingSystemMXBean

actual fun processCpuSeconds(): Double = os.processCpuTime / 1e9

/** The JVM has no thermal reading, and on a plugged-in desktop there would be nothing to read. */
actual fun thermalState(): String = "unknown"

actual fun batteryPercent(): Double? = null

actual fun footprintMB(): Double? =
    Runtime.getRuntime().let { (it.totalMemory() - it.freeMemory()) / 1_048_576.0 }

private val threadBean = ManagementFactory.getThreadMXBean()

actual fun threadCpuSeconds(): Map<String, Double> {
    val result = mutableMapOf<String, Double>()
    for (info in threadBean.getThreadInfo(threadBean.allThreadIds)) {
        info ?: continue
        val ns = threadBean.getThreadCpuTime(info.threadId)
        if (ns < 0) continue
        result.merge(info.threadName.ifEmpty { "unnamed" }, ns / 1e9, Double::plus)
    }
    return result
}

/** JVM threads are named already; the desktop's UI thread reports as itself. */
actual fun markCurrentThreadAsMain() {}
