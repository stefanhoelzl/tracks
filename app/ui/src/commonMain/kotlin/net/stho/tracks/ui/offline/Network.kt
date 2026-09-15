package net.stho.tracks.ui.offline

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeoutConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import net.stho.tracks.offline.Network

/** The network the phone is on — null for none — kept current for as long as [scope] lives. */
expect fun networkState(scope: CoroutineScope): StateFlow<Network?>

/** The HTTP client segment tiles download through, on this platform's engine. */
expect fun downloadHttpClient(): HttpClient

/** A segment tile is 200–250 MB: on a weak mobile link that is an hour, so only silence ends a download, never its length. */
internal fun HttpTimeoutConfig.downloadTimeouts() {
    connectTimeoutMillis = 30_000
    socketTimeoutMillis = 60_000
}
