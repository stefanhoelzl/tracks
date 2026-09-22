package net.stho.tracks.ui.measure

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.get
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.sizeOf
import kotlinx.cinterop.toKString
import kotlinx.cinterop.toLong
import kotlinx.cinterop.value
import platform.darwin.KERN_SUCCESS
import platform.darwin.THREAD_EXTENDED_INFO
import platform.darwin.mach_msg_type_number_tVar
import platform.darwin.mach_port_deallocate
import platform.darwin.mach_task_self_
import platform.darwin.natural_tVar
import platform.darwin.task_threads
import platform.darwin.thread_act_array_tVar
import platform.darwin.thread_act_tVar
import platform.darwin.thread_extended_info
import platform.darwin.thread_info
import platform.darwin.vm_deallocate
import platform.posix.pthread_mach_thread_np
import platform.posix.pthread_self
import platform.Foundation.NSNumber
import platform.Foundation.NSProcessInfo
import platform.Foundation.valueForKey
import platform.UIKit.UIDevice
import platform.posix.CLOCK_PROCESS_CPUTIME_ID
import platform.posix.clock_gettime
import platform.posix.timespec

/**
 * What a measured run can read about its own cost on the phone.
 *
 * CPU comes from `CLOCK_PROCESS_CPUTIME_ID` rather than the mach task info M10's Swift harness uses: it is the
 * whole process across every thread, it is one call, and it needs no cinterop beyond `timespec`. Footprint is
 * left to that Swift harness, which already samples `phys_footprint` properly — memory is not this
 * investigation's question, and a second, worse implementation of it would only invite disagreement.
 */
@OptIn(ExperimentalForeignApi::class)
actual fun processCpuSeconds(): Double = memScoped {
    val t = alloc<timespec>()
    if (clock_gettime(CLOCK_PROCESS_CPUTIME_ID.toUInt(), t.ptr) != 0) return@memScoped 0.0
    t.tv_sec.toDouble() + t.tv_nsec.toDouble() / 1e9
}

/**
 * Thermal pressure, read through key-value coding.
 *
 * The `NSProcessInfoThermalState` enum is in Kotlin/Native's Foundation, but `NSProcessInfo.thermalState`
 * itself is not exposed as a property, so there is nothing to call. KVC reaches the same getter, and the
 * constants are Apple's documented order.
 */
actual fun thermalState(): String =
    when ((NSProcessInfo.processInfo.valueForKey("thermalState") as? NSNumber)?.intValue) {
        0 -> "nominal"
        1 -> "fair"
        2 -> "serious"
        3 -> "critical"
        else -> "unknown"
    }

/**
 * The battery, as a percentage.
 *
 * Coarse — iOS reports it in steps — and on a worn pack the percentages are inflated besides, so this is only
 * ever a ratio between two runs. Charge drawn in mAh, which degradation does not touch, is read over the wire
 * at each run's boundary instead.
 */
actual fun batteryPercent(): Double? {
    val device = UIDevice.currentDevice
    if (!device.batteryMonitoringEnabled) device.batteryMonitoringEnabled = true
    val level = device.batteryLevel
    return if (level < 0) null else level.toDouble() * 100
}

actual fun footprintMB(): Double? = null

/**
 * Every thread's CPU time, from `THREAD_EXTENDED_INFO` — which carries the thread's name (`pth_name`) beside its
 * user and system time, so one call per thread gives both. MapLibre and maplibre-compose name theirs
 * (`maplibre-compose-render`, `org.maplibre.mbgl.Worker 1`, …); GCD's workers are mostly unnamed.
 */
private var mainThreadPort: UInt = 0u

@OptIn(ExperimentalForeignApi::class)
actual fun markCurrentThreadAsMain() {
    mainThreadPort = pthread_mach_thread_np(pthread_self())
}

@OptIn(ExperimentalForeignApi::class)
actual fun threadCpuSeconds(): Map<String, Double> = memScoped {
    val list = alloc<thread_act_array_tVar>()
    val count = alloc<mach_msg_type_number_tVar>()
    if (task_threads(mach_task_self_, list.ptr, count.ptr) != KERN_SUCCESS) return@memScoped emptyMap()
    val threads = list.value ?: return@memScoped emptyMap()
    val n = count.value.toInt()
    val result = mutableMapOf<String, Double>()
    val words = (sizeOf<thread_extended_info>() / sizeOf<natural_tVar>()).toUInt()
    for (i in 0 until n) {
        val thread = threads[i]
        val info = alloc<thread_extended_info>()
        val infoCount = alloc<mach_msg_type_number_tVar>().apply { value = words }
        if (thread_info(thread, THREAD_EXTENDED_INFO.toUInt(), info.ptr.reinterpret(), infoCount.ptr) == KERN_SUCCESS) {
            val name = if (thread == mainThreadPort) "main" else info.pth_name.toKString().ifEmpty { "unnamed" }
            val secs = (info.pth_user_time + info.pth_system_time).toDouble() / 1e9
            result[name] = (result[name] ?: 0.0) + secs
        }
        mach_port_deallocate(mach_task_self_, thread)
    }
    vm_deallocate(mach_task_self_, threads.toLong().toULong(), (n * sizeOf<thread_act_tVar>()).toULong())
    result
}
