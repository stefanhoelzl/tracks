package net.stho.tracks.ui.upload

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeoutConfig

/** The HTTP client uploads go through, on this platform's engine: no cookie jar, and timeouts a slow uplink survives. */
expect fun tracksHttpClient(): HttpClient

/** A ten-hour ride is a megabyte; on a weak mobile uplink that is minutes, not seconds. */
internal fun HttpTimeoutConfig.tracksTimeouts() {
    connectTimeoutMillis = 30_000
    socketTimeoutMillis = 60_000
    requestTimeoutMillis = 5 * 60_000
}
