package net.stho.tracks.ui.upload

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.HttpTimeout

/**
 * NSURLSession, with its cookie jar switched off. Left on, it would store the session from `Set-Cookie` and send it
 * again beside the one the app writes — and decide by itself when a cookie is not worth sending.
 */
actual fun tracksHttpClient(): HttpClient = HttpClient(Darwin) {
    install(HttpTimeout) { tracksTimeouts() }
    engine {
        configureSession {
            HTTPCookieStorage = null
            HTTPShouldSetCookies = false
        }
    }
}
