package net.stho.tracks.ui.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.java.Java
import io.ktor.client.plugins.HttpTimeout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import net.stho.tracks.offline.Network

/** The harness is on a desk: its network is whatever the desk has, and never metered. */
actual fun networkState(scope: CoroutineScope): StateFlow<Network?> = MutableStateFlow(Network.Unmetered)

actual fun downloadHttpClient(): HttpClient = HttpClient(Java) {
    install(HttpTimeout) { downloadTimeouts() }
}
