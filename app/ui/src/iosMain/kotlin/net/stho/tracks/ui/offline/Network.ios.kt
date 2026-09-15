package net.stho.tracks.ui.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.HttpTimeout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.stho.tracks.offline.Network
import platform.Network.nw_path_get_status
import platform.Network.nw_path_is_constrained
import platform.Network.nw_path_is_expensive
import platform.Network.nw_path_monitor_cancel
import platform.Network.nw_path_monitor_create
import platform.Network.nw_path_monitor_set_queue
import platform.Network.nw_path_monitor_set_update_handler
import platform.Network.nw_path_monitor_start
import platform.Network.nw_path_status_satisfied
import platform.darwin.dispatch_get_main_queue

/**
 * The phone's network path, as iOS judges it: a path it calls expensive (cellular, a phone's hotspot) or constrained (Low
 * Data Mode) is metered, anything else unmetered.
 */
actual fun networkState(scope: CoroutineScope): StateFlow<Network?> {
    val state = MutableStateFlow<Network?>(null)
    val monitor = nw_path_monitor_create()
    nw_path_monitor_set_queue(monitor, dispatch_get_main_queue())
    nw_path_monitor_set_update_handler(monitor) { path ->
        state.value = when {
            nw_path_get_status(path) != nw_path_status_satisfied -> null
            nw_path_is_expensive(path) || nw_path_is_constrained(path) -> Network.Metered
            else -> Network.Unmetered
        }
    }
    nw_path_monitor_start(monitor)
    scope.coroutineContext[Job]?.invokeOnCompletion { nw_path_monitor_cancel(monitor) }
    return state.asStateFlow()
}

actual fun downloadHttpClient(): HttpClient = HttpClient(Darwin) {
    install(HttpTimeout) { downloadTimeouts() }
}
